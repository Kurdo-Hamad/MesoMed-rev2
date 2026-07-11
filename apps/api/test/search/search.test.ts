import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { searchOutputSchema } from "@mesomed/contracts/search";
import {
  domainEvents,
  eq,
  processedEvents,
  providerProfiles,
  providers,
  searchDocuments,
  user,
  and,
} from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { waitFor } from "../helpers.js";
import {
  ADMIN,
  buildDirectoryTestServer,
  result,
  seedBaseFixture,
  trpc,
} from "../directory/helpers.js";

/**
 * Phase 3 gate: search read models refresh from directory events via the
 * outbox dispatcher, stay consistent under redelivery (idempotent
 * subscriber), and a poisoned event dead-letters without corrupting the
 * read model. Search owns its table and never joins directory (§3.1).
 */
describe("search read models", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildDirectoryTestServer(tdb.connectionString);
    await app.ready();
    await seedBaseFixture(app);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  const search = (query: string) =>
    trpc(app, "search.listings", "query", { query }, { country: "IQ" });

  it("indexes a facility from its created event and serves trilingual search", async () => {
    const res = await trpc(
      app,
      "directory.upsertFacility",
      "mutation",
      {
        slug: "zheen-hospital",
        categorySlug: "hospital",
        citySlug: "erbil",
        name: { en: "Zheen General Hospital", ar: "مستشفى جين العام", ckb: "نەخۆشخانەی گشتی ژین" },
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(200);

    // The dispatcher delivers asynchronously — wait for the read model.
    const hit = await waitFor(async () => {
      const searched = await search("zheen");
      const body = searchOutputSchema.parse(result(searched));
      return body.items.find((item) => item.slug === "zheen-hospital");
    });
    expect(hit.name).toEqual({
      en: "Zheen General Hospital",
      ar: "مستشفى جين العام",
      ckb: "نەخۆشخانەی گشتی ژین",
    });
    expect(hit.entityType).toBe("facility");
    expect(hit.categoryKey).toBe("hospital");

    // Arabic and Kurdish substrings hit through the same read model.
    for (const query of ["مستشفى جين", "ژین"]) {
      const localized = searchOutputSchema.parse(result(await search(query)));
      expect(localized.items.map((item) => item.slug)).toContain("zheen-hospital");
    }
  });

  it("indexes doctors and applies filters", async () => {
    await trpc(
      app,
      "directory.upsertDoctorProfile",
      "mutation",
      {
        slug: "dr-zheen-search",
        name: { en: "Dr. Zheen Kareem", ar: "د. جين كريم", ckb: "د. ژین کەریم" },
        specialtyKey: "cardiology",
        citySlug: "erbil",
      },
      ADMIN,
    );
    await waitFor(async () => {
      const searched = searchOutputSchema.parse(result(await search("zheen")));
      return searched.items.some((item) => item.slug === "dr-zheen-search");
    });

    const doctorsOnly = await trpc(
      app,
      "search.listings",
      "query",
      { query: "zheen", entityType: "doctor" },
      { country: "IQ" },
    );
    const body = searchOutputSchema.parse(result(doctorsOnly));
    expect(body.items.every((item) => item.entityType === "doctor")).toBe(true);
    expect(body.items.map((item) => item.slug)).toContain("dr-zheen-search");
  });

  it("stays consistent under event redelivery (idempotent subscriber)", async () => {
    const { db, dispatcher } = app.kernel;
    const [event] = await db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.name, "directory.facility_created.v1"))
      .limit(1);
    expect(event).toBeDefined();

    const rowsBefore = await db
      .select()
      .from(searchDocuments)
      .where(eq(searchDocuments.slug, "zheen-hospital"));
    expect(rowsBefore).toHaveLength(1);

    // Force two redeliveries of an already-processed event through the
    // real handler path.
    await dispatcher.redeliver(event!.id);
    await dispatcher.redeliver(event!.id);

    const rowsAfter = await db
      .select()
      .from(searchDocuments)
      .where(eq(searchDocuments.slug, "zheen-hospital"));
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0]).toEqual(rowsBefore[0]);

    // Exactly one idempotency claim per handler for this event.
    const claims = await db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.eventId, event!.id));
    expect(claims).toHaveLength(1);
  });

  it("dead-letters a poisoned event without corrupting the read model", async () => {
    const { db, dispatcher } = app.kernel;
    // A raw outbox row that names a registered contract but violates its
    // payload schema — registry.parse must reject it on delivery.
    const [poisoned] = await db
      .insert(domainEvents)
      .values({
        name: "directory.facility_created.v1",
        version: 1,
        aggregateType: "facility",
        aggregateId: "poisoned",
        payload: { facilityId: 42, nope: true },
      })
      .returning({ id: domainEvents.id });

    const dead = await waitFor(async () => {
      await dispatcher.pump();
      const [row] = await db
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.id, poisoned!.id), eq(domainEvents.status, "dead")));
      return row;
    });
    expect(dead.status).toBe("dead");
    expect(dead.lastError).toBeTruthy();

    // Read model untouched: still exactly the documents indexed before.
    const zheen = await db
      .select()
      .from(searchDocuments)
      .where(eq(searchDocuments.slug, "zheen-hospital"));
    expect(zheen).toHaveLength(1);
    const searched = searchOutputSchema.parse(result(await search("zheen")));
    expect(searched.items.length).toBeGreaterThan(0);
  });

  it("flips visibility end-to-end on identity.provider_status_changed.v1", async () => {
    const { db, outbox } = app.kernel;

    // A registered identity provider profile (pending → not approved).
    await db.insert(user).values({
      id: "provider-user-1",
      name: "Provider One",
      email: "provider-one@example.test",
    });
    const [identityProfile] = await db
      .insert(providerProfiles)
      .values({ userId: "provider-user-1", providerType: "hospital", phone: "+9647700000000" })
      .returning({ id: providerProfiles.id });

    // Its facility listing: created while pending → publicly invisible.
    const created = await trpc(
      app,
      "directory.upsertFacility",
      "mutation",
      {
        slug: "pending-provider-hospital",
        categorySlug: "hospital",
        citySlug: "erbil",
        name: { en: "Pending Hospital", ar: "مستشفى معلق", ckb: "نەخۆشخانەی هەڵواسراو" },
        identityProfileId: identityProfile!.id,
      },
      ADMIN,
    );
    expect(created.statusCode).toBe(200);

    // Indexed as invisible: never surfaces in search results.
    await waitFor(async () => {
      const [doc] = await db
        .select()
        .from(searchDocuments)
        .where(eq(searchDocuments.slug, "pending-provider-hospital"));
      return doc;
    });
    const before = searchOutputSchema.parse(result(await search("pending")));
    expect(before.items.map((item) => item.slug)).not.toContain("pending-provider-hospital");
    const detailBefore = await trpc(
      app,
      "directory.facilityDetail",
      "query",
      { slugOrId: "pending-provider-hospital" },
      { country: "IQ" },
    );
    expect(detailBefore.statusCode).toBe(404);

    // Identity approves the provider (Phase 2 command emits this event).
    await db.transaction(async (tx) => {
      await tx
        .update(providerProfiles)
        .set({ status: "approved" })
        .where(eq(providerProfiles.id, identityProfile!.id));
      await outbox.emit(tx, {
        name: "identity.provider_status_changed.v1",
        aggregateType: "provider_profile",
        aggregateId: identityProfile!.id,
        payload: {
          providerProfileId: identityProfile!.id,
          userId: "provider-user-1",
          from: "pending",
          to: "approved",
          changedBy: "admin-user",
          reason: null,
        },
      });
    });

    // Directory mirror flips, the listing becomes visible, and the chained
    // directory.facility_updated.v1 refreshes the search read model.
    await waitFor(async () => {
      const [mirror] = await db
        .select()
        .from(providers)
        .where(eq(providers.identityProfileId, identityProfile!.id));
      return mirror?.approved === true ? mirror : undefined;
    });
    await waitFor(async () => {
      const searched = searchOutputSchema.parse(result(await search("pending")));
      return searched.items.some((item) => item.slug === "pending-provider-hospital");
    });
    const detailAfter = await trpc(
      app,
      "directory.facilityDetail",
      "query",
      { slugOrId: "pending-provider-hospital" },
      { country: "IQ" },
    );
    expect(detailAfter.statusCode).toBe(200);
  });
});
