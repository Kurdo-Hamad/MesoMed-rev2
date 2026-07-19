import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  doctorProfiles,
  domainEvents,
  eq,
  facilities,
  inArray,
  searchDocuments,
} from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { seedDirectory } from "../../scripts/seed/seed-directory.js";
import { seedUuid } from "../../scripts/seed/seed-uuid.js";
import { waitFor } from "../helpers.js";
import { buildDirectoryTestServer, result, trpc } from "./helpers.js";

/**
 * Seed pipeline gate (MM-PLAN-001 §5 Phase 3): the adapted 4-script seed is
 * idempotent (re-run converges, no duplicates), uses deterministic UUIDs,
 * and leaves a directory that is browsable end-to-end with the search read
 * model populated through the real dispatcher.
 */
describe("directory seed pipeline", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  async function drainOutbox(): Promise<void> {
    const { db, dispatcher } = app.kernel;
    await waitFor(
      async () => {
        await dispatcher.pump();
        const open = await db
          .select({ id: domainEvents.id })
          .from(domainEvents)
          .where(inArray(domainEvents.status, ["pending", "published"]))
          .limit(1);
        return open.length === 0;
      },
      // The assertion is convergence, not speed: ~150 events at the test
      // env's 0.5s worker poll takes >75s even unloaded, and the
      // idempotency re-run doubles the backlog. 120s proved marginal on
      // slower dev machines (Windows embedded-postgres harness).
      { timeoutMs: 240_000, intervalMs: 250 },
    );
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildDirectoryTestServer(tdb.connectionString);
    await app.ready();
    const { db, config, outbox } = app.kernel;
    await seedDirectory({ db, config, outbox });
    await drainOutbox();
  }, 300_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("creates the full listing set with deterministic UUIDs", async () => {
    const { db } = app.kernel;
    // 30 ported listings (10 each for hospital/dental/beauty) + 32
    // multicountry expansion listings (ADR-0055).
    const facilityRows = await db.select({ id: facilities.id }).from(facilities);
    expect(facilityRows).toHaveLength(62);
    const doctorRows = await db.select({ id: doctorProfiles.id }).from(doctorProfiles);
    expect(doctorRows).toHaveLength(43);

    // Deterministic ids: the first facility/doctor use the pinned seed UUIDs.
    const [firstFacility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(eq(facilities.slug, "erbil-international-hospital"));
    expect(firstFacility?.id).toBe(seedUuid("d", 1));
    // Expansion listings continue the same block from d31.
    const [firstExpansion] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(eq(facilities.slug, "kirkuk-central-lab"));
    expect(firstExpansion?.id).toBe(seedUuid("d", 31));
    const [firstDoctor] = await db
      .select({ id: doctorProfiles.id })
      .from(doctorProfiles)
      .where(eq(doctorProfiles.slug, "dr-ahmed-doctor"));
    expect(firstDoctor?.id).toBe(seedUuid("f", 1));
  });

  it("is idempotent: re-running converges with no duplicates", { timeout: 360_000 }, async () => {
    const { db, config, outbox } = app.kernel;
    await seedDirectory({ db, config, outbox });
    await drainOutbox();

    expect(await db.select({ id: facilities.id }).from(facilities)).toHaveLength(62);
    expect(await db.select({ id: doctorProfiles.id }).from(doctorProfiles)).toHaveLength(43);
    // One search document per listing — upserts, not appends.
    expect(await db.select().from(searchDocuments)).toHaveLength(105);
  });

  it("leaves the seeded directory browsable via tRPC with search populated", async () => {
    const browse = await trpc(
      app,
      "directory.browseFacilities",
      "query",
      { categorySlug: "hospital", limit: 12 },
      { country: "IQ", locale: "ckb" },
    );
    expect(browse.statusCode).toBe(200);
    const { items } = result<{ items: Array<{ slug: string; name: Record<string, string> }> }>(
      browse,
    );
    // 7 of the 10 ported hospitals are publicly visible, plus the 2 Iraqi
    // expansion hospitals; the 5 non-IQ ones are country-scoped away.
    expect(items).toHaveLength(9);
    const zheen = items.find((item) => item.slug === "zheen-general-hospital");
    expect(zheen?.name.ckb).toBe("نەخۆشخانەی گشتی ژین");

    const feed = await trpc(
      app,
      "directory.homepageFeed",
      "query",
      { citySlug: "erbil", limit: 8 },
      { country: "IQ" },
    );
    expect(feed.statusCode).toBe(200);
    const { slots } = result<{ slots: Array<{ promoted: boolean }> }>(feed);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]?.promoted).toBe(true);

    const searched = await trpc(
      app,
      "search.listings",
      "query",
      { query: "ژین" },
      { country: "IQ" },
    );
    expect(searched.statusCode).toBe(200);
    const hits = result<{ items: Array<{ slug: string }> }>(searched);
    expect(hits.items.map((item) => item.slug)).toContain("zheen-general-hospital");
  });

  it("seeds the multicountry catalog: non-IQ listings and per-country tiles", async () => {
    const browse = await trpc(
      app,
      "directory.browseFacilities",
      "query",
      { categorySlug: "hospital", limit: 12 },
      { country: "IR" },
    );
    expect(browse.statusCode).toBe(200);
    const { items } = result<{ items: Array<{ slug: string }> }>(browse);
    expect(items.map((item) => item.slug)).toEqual(["tehran-international-hospital"]);

    // IR is configured (seedCategoryConfig): the reserved doctors tile plus
    // the four launch categories, deferred ones carrying coming_soon.
    const iranian = await trpc(app, "directory.listHomepageTiles", "query", undefined, {
      country: "IR",
    });
    expect(iranian.statusCode).toBe(200);
    expect(
      result<Array<{ kind: string; slug?: string; status?: string }>>(iranian).map((tile) =>
        tile.kind === "doctors" ? "doctors" : `${tile.slug}:${tile.status}`,
      ),
    ).toEqual([
      "doctors",
      "hospital:active",
      "dental_clinic:active",
      "hair_transplant:active",
      "online_consultation:coming_soon",
    ]);

    // IQ is deliberately unlisted: the full active category list, no
    // doctors tile.
    const iraqi = await trpc(app, "directory.listHomepageTiles", "query", undefined, {
      country: "IQ",
    });
    expect(iraqi.statusCode).toBe(200);
    const iraqiTiles = result<Array<{ kind: string; slug?: string }>>(iraqi);
    expect(iraqiTiles.every((tile) => tile.kind === "category")).toBe(true);
    expect(iraqiTiles).toHaveLength(11);
  });
});
