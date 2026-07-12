import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { categories, domainEvents, eq, facilities, inArray } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { waitFor } from "../helpers.js";
import { ADMIN, buildDirectoryTestServer, result, seedBaseFixture, trpc } from "./helpers.js";

interface FeedSlot {
  kind: "facility" | "doctor";
  facility?: { slug: string; name: { en: string; ar: string; ckb: string } };
}

interface CategoryRow {
  slug: string;
  name: { en: string; ar: string; ckb: string };
}

/**
 * Directory read cache, end to end (ADR-0012): the homepage feed and
 * taxonomy lists are served cache-aside, keyed per locale, and invalidated
 * by the module's own domain events through the real dispatcher. Staleness
 * is proven by writing to the tables directly — the one path events cannot
 * see — and freshness by the API write path that emits them.
 */
describe("directory read cache", () => {
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
      { timeoutMs: 90_000, intervalMs: 250 },
    );
  }

  async function upsertCacheHospital(nameEn: string): Promise<void> {
    const res = await trpc(
      app,
      "directory.upsertFacility",
      "mutation",
      {
        slug: "cache-hospital",
        categorySlug: "hospital",
        citySlug: "erbil",
        name: { en: nameEn, ar: "مستشفى الذاكرة", ckb: "نەخۆشخانەی بیرگە" },
        address: { en: "Gulan St", ar: "شارع كولان", ckb: "شەقامی گوڵان" },
        active: true,
        tierRank: 1,
        tierExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        media: [],
        sections: [],
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(200);
  }

  async function feed(locale: string): Promise<FeedSlot[]> {
    const res = await trpc(app, "directory.homepageFeed", "query", { limit: 6 }, { locale });
    expect(res.statusCode).toBe(200);
    return result<{ slots: FeedSlot[] }>(res).slots;
  }

  const bySlug = (slots: FeedSlot[]) => slots.find((s) => s.facility?.slug === "cache-hospital");

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildDirectoryTestServer(tdb.connectionString);
    await app.ready();
    await seedBaseFixture(app);
    await upsertCacheHospital("Cache Hospital");
    // Settle every seed event before any read: each one busts the cache,
    // so an undrained backlog would fake the invalidation under test.
    await drainOutbox();
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("serves the homepage feed from cache: a direct table write is invisible to the cached locale", async () => {
    const before = bySlug(await feed("en"));
    expect(before?.facility?.name.en).toBe("Cache Hospital");

    // Bypass the event bus on purpose — nothing may invalidate.
    await app.kernel.db
      .update(facilities)
      .set({ nameEn: "Raw Renamed Hospital" })
      .where(eq(facilities.slug, "cache-hospital"));

    const after = bySlug(await feed("en"));
    expect(after?.facility?.name.en).toBe("Cache Hospital");
  });

  it("keys the feed per locale: another locale misses the stale entry and reads fresh", async () => {
    const arSlot = bySlug(await feed("ar"));
    expect(arSlot?.facility?.name.en).toBe("Raw Renamed Hospital");
  });

  it("invalidates on the module's own events: an API rename reaches the previously cached locale", async () => {
    await upsertCacheHospital("Event Renamed Hospital");
    await drainOutbox();
    const slot = bySlug(await feed("en"));
    expect(slot?.facility?.name.en).toBe("Event Renamed Hospital");
  });

  it("serves taxonomy lists from cache and busts them on any directory event", async () => {
    const first = await trpc(app, "directory.listCategories", "query");
    expect(first.statusCode).toBe(200);
    const hospital = result<{ categories: CategoryRow[] }>(first).categories.find(
      (c) => c.slug === "hospital",
    );
    expect(hospital?.name.en).toBe("Hospitals");

    await app.kernel.db
      .update(categories)
      .set({ nameEn: "Raw Renamed Category" })
      .where(eq(categories.slug, "hospital"));

    const cachedRead = result<{ categories: CategoryRow[] }>(
      await trpc(app, "directory.listCategories", "query"),
    ).categories.find((c) => c.slug === "hospital");
    expect(cachedRead?.name.en).toBe("Hospitals");

    // Any directory event busts the module prefix — a specialty upsert
    // suffices to refresh the category list.
    const specialty = await trpc(
      app,
      "directory.upsertSpecialty",
      "mutation",
      { key: "dermatology", name: { en: "Dermatology", ar: "الأمراض الجلدية", ckb: "پێست" } },
      ADMIN,
    );
    expect(specialty.statusCode).toBe(200);
    await drainOutbox();

    const freshRead = result<{ categories: CategoryRow[] }>(
      await trpc(app, "directory.listCategories", "query"),
    ).categories.find((c) => c.slug === "hospital");
    expect(freshRead?.name.en).toBe("Raw Renamed Category");
  });
});
