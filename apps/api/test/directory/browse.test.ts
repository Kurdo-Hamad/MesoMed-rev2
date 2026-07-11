import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  browseFacilitiesOutputSchema,
  facilityDetailOutputSchema,
  homepageFeedOutputSchema,
} from "@mesomed/contracts/directory";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { ADMIN, buildDirectoryTestServer, result, seedBaseFixture, trpc } from "./helpers.js";

interface Card {
  id: string;
  slug: string;
  name: { en: string; ar: string; ckb: string };
  tierRank: number;
  featured: boolean;
}

/**
 * Phase 3 gate: seeded directory browsable via tRPC — keyset browse, detail
 * with media/sections, homepage feed — with trilingual fields round-tripped
 * intact (ckb/ar/en) and contract-schema round-trips (§3.12).
 */
describe("directory browse / detail / homepage feed", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  const FACILITIES = [
    // Two tier-1 (one expired → demoted at read), one tier-2, three tier-3.
    {
      slug: "alpha-hospital",
      en: "Alpha Hospital",
      ar: "مستشفى ألفا",
      ckb: "نەخۆشخانەی ئەلفا",
      tier: 1,
    },
    {
      slug: "omega-hospital",
      en: "Omega Hospital",
      ar: "مستشفى أوميغا",
      ckb: "نەخۆشخانەی ئۆمێگا",
      tier: 1,
      expired: true,
    },
    {
      slug: "beta-hospital",
      en: "Beta Hospital",
      ar: "مستشفى بيتا",
      ckb: "نەخۆشخانەی بێتا",
      tier: 2,
    },
    {
      slug: "gamma-hospital",
      en: "Gamma Hospital",
      ar: "مستشفى غاما",
      ckb: "نەخۆشخانەی گاما",
      tier: 3,
    },
    {
      slug: "delta-hospital",
      en: "Delta Hospital",
      ar: "مستشفى دلتا",
      ckb: "نەخۆشخانەی دێلتا",
      tier: 3,
    },
    {
      slug: "zeta-hospital",
      en: "Zeta Hospital",
      ar: "مستشفى زيتا",
      ckb: "نەخۆشخانەی زێتا",
      tier: 3,
    },
    // Inactive: must never surface publicly.
    {
      slug: "ghost-hospital",
      en: "Ghost Hospital",
      ar: "مستشفى الشبح",
      ckb: "نەخۆشخانەی تارمایی",
      tier: 3,
      inactive: true,
    },
  ] as const;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildDirectoryTestServer(tdb.connectionString);
    await app.ready();
    await seedBaseFixture(app);

    for (const facility of FACILITIES) {
      const res = await trpc(
        app,
        "directory.upsertFacility",
        "mutation",
        {
          slug: facility.slug,
          categorySlug: "hospital",
          citySlug: "erbil",
          name: { en: facility.en, ar: facility.ar, ckb: facility.ckb },
          address: { en: "Gulan St", ar: "شارع كولان", ckb: "شەقامی گوڵان" },
          active: !("inactive" in facility && facility.inactive),
          tierRank: facility.tier,
          tierExpiresAt:
            facility.tier === 3
              ? null
              : new Date(
                  Date.now() + ("expired" in facility && facility.expired ? -1 : 30) * 86_400_000,
                ).toISOString(),
          media: [
            { storagePath: "/img/1.svg", sortOrder: 0, alt: { en: "a", ar: "أ", ckb: "ئ" } },
            { storagePath: "/img/2.svg", sortOrder: 1 },
            { storagePath: "/img/3.svg", sortOrder: 2 },
          ],
          sections: [
            {
              sectionTypeKey: "department",
              name: { en: "Cardiology", ar: "أمراض القلب", ckb: "نەخۆشییەکانی دڵ" },
              sortOrder: 0,
            },
          ],
        },
        ADMIN,
      );
      expect(res.statusCode, facility.slug).toBe(200);
    }

    const doctor = await trpc(
      app,
      "directory.upsertDoctorProfile",
      "mutation",
      {
        slug: "dr-ahmed",
        name: { en: "Dr. Ahmed", ar: "د. أحمد", ckb: "د. ئەحمەد" },
        bio: { en: "Cardiologist", ar: "طبيب قلب", ckb: "پزیشکی دڵ" },
        specialtyKey: "cardiology",
        citySlug: "erbil",
      },
      ADMIN,
    );
    expect(doctor.statusCode).toBe(200);

    const promo = await trpc(
      app,
      "directory.upsertPromotion",
      "mutation",
      {
        entityType: "facility",
        categorySlug: "hospital",
        entityRef: "beta-hospital",
        citySlug: "erbil",
        sortOrder: 0,
      },
      ADMIN,
    );
    expect(promo.statusCode).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("keyset-paginates the stable landing sort with no duplicates or gaps", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await trpc(
        app,
        "directory.browseFacilities",
        "query",
        { categorySlug: "hospital", limit: 2, ...(cursor ? { cursor } : {}) },
        { country: "IQ", locale: "en" },
      );
      expect(res.statusCode).toBe(200);
      const body = browseFacilitiesOutputSchema.parse(result(res));
      seen.push(...body.items.map((item) => item.slug));
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    // 6 visible facilities (ghost-hospital hidden), each exactly once.
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect(seen).not.toContain("ghost-hospital");
    // Stored sort: tier 1 first (alpha, omega), tier 2, then tier 3 by name.
    expect(seen.slice(0, 2)).toEqual(["alpha-hospital", "omega-hospital"]);
    expect(seen[2]).toBe("beta-hospital");
  });

  it("round-trips trilingual fields intact (ckb/ar/en)", async () => {
    const res = await trpc(
      app,
      "directory.browseFacilities",
      "query",
      { categorySlug: "hospital", limit: 12 },
      { country: "IQ", locale: "ckb" },
    );
    const body = browseFacilitiesOutputSchema.parse(result(res));
    const alpha = body.items.find((item) => item.slug === "alpha-hospital");
    expect(alpha?.name).toEqual({
      en: "Alpha Hospital",
      ar: "مستشفى ألفا",
      ckb: "نەخۆشخانەی ئەلفا",
    });
    expect(alpha?.cityName).toEqual({ en: "Erbil", ar: "أربيل", ckb: "هەولێر" });
  });

  it("demotes an expired tier at read time (featured=false, rank 3)", async () => {
    const res = await trpc(
      app,
      "directory.browseFacilities",
      "query",
      { categorySlug: "hospital", limit: 12 },
      { country: "IQ" },
    );
    const items = result<{ items: Card[] }>(res).items;
    const expired = items.find((item) => item.slug === "omega-hospital");
    expect(expired?.tierRank).toBe(3);
    expect(expired?.featured).toBe(false);
    const live = items.find((item) => item.slug === "alpha-hospital");
    expect(live?.featured).toBe(true);
  });

  it("facility detail returns trilingual sections and caps media by effective tier", async () => {
    const res = await trpc(
      app,
      "directory.facilityDetail",
      "query",
      { slugOrId: "gamma-hospital" },
      { country: "IQ" },
    );
    expect(res.statusCode).toBe(200);
    const detail = facilityDetailOutputSchema.parse(result(res));
    expect(detail.name.ckb).toBe("نەخۆشخانەی گاما");
    expect(detail.address?.ar).toBe("شارع كولان");
    expect(detail.sections[0]?.name.ckb).toBe("نەخۆشییەکانی دڵ");
    expect(detail.sections[0]?.sectionTypeLabel.ar).toBe("الأقسام");
    // Tier 3 gallery cap is 2 — the third uploaded image is never served.
    expect(detail.media).toHaveLength(2);
  });

  it("hides inactive listings from browse and detail", async () => {
    const res = await trpc(
      app,
      "directory.facilityDetail",
      "query",
      { slugOrId: "ghost-hospital" },
      { country: "IQ" },
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.appCode).toBe("NOT_FOUND");
  });

  it("doctor browse and detail serve the seeded profile trilingually", async () => {
    const browse = await trpc(
      app,
      "directory.browseDoctors",
      "query",
      { specialtyKey: "cardiology" },
      { country: "IQ" },
    );
    expect(browse.statusCode).toBe(200);
    const items = result<{ items: Array<{ slug: string; name: Record<string, string> }> }>(
      browse,
    ).items;
    expect(items.map((item) => item.slug)).toContain("dr-ahmed");

    const detail = await trpc(
      app,
      "directory.doctorDetail",
      "query",
      { slugOrId: "dr-ahmed" },
      { country: "IQ" },
    );
    expect(detail.statusCode).toBe(200);
    const doctor = result<{ name: Record<string, string>; specialtyName: Record<string, string> }>(
      detail,
    );
    expect(doctor.name.ckb).toBe("د. ئەحمەد");
    expect(doctor.specialtyName.ar).toBe("أمراض القلب");
  });

  it("homepage feed resolves promotions first, then fills with live featured tier-1s", async () => {
    const res = await trpc(
      app,
      "directory.homepageFeed",
      "query",
      { citySlug: "erbil", limit: 4 },
      { country: "IQ" },
    );
    expect(res.statusCode).toBe(200);
    const feed = homepageFeedOutputSchema.parse(result(res));

    // Slot 0: the curated beta-hospital promotion.
    const first = feed.slots[0];
    expect(first).toBeDefined();
    if (first?.kind !== "facility") throw new Error("expected a facility slot first");
    expect(first.promoted).toBe(true);
    expect(first.facility.slug).toBe("beta-hospital");

    // Fill: alpha (live tier-1) present; omega (expired tier-1) excluded.
    const fillSlugs = feed.slots
      .filter((slot) => slot.kind === "facility" && !slot.promoted)
      .map((slot) => (slot.kind === "facility" ? slot.facility.slug : ""));
    expect(fillSlugs).toContain("alpha-hospital");
    expect(fillSlugs).not.toContain("omega-hospital");
  });

  it("drops a promotion whose listing lost public visibility (never errors)", async () => {
    // Promote the hidden facility; the resolver must skip it silently.
    await trpc(
      app,
      "directory.upsertPromotion",
      "mutation",
      {
        entityType: "facility",
        categorySlug: "hospital",
        entityRef: "ghost-hospital",
        citySlug: "erbil",
        sortOrder: 1,
      },
      ADMIN,
    );
    const res = await trpc(
      app,
      "directory.homepageFeed",
      "query",
      { citySlug: "erbil", limit: 8 },
      { country: "IQ" },
    );
    expect(res.statusCode).toBe(200);
    const feed = homepageFeedOutputSchema.parse(result(res));
    const slugs = feed.slots.map((slot) =>
      slot.kind === "facility" ? slot.facility.slug : slot.doctor.slug,
    );
    expect(slugs).not.toContain("ghost-hospital");
  });
});
