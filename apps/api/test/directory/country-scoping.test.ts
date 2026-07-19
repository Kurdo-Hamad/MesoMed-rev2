import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { ADMIN, buildDirectoryTestServer, result, seedBaseFixture, trpc } from "./helpers.js";

/**
 * Country scoping (ADR-0055): the three list surfaces — browseFacilities,
 * browseDoctors, homepageFeed — serve only listings whose city belongs to
 * the request country. Detail procedures stay unscoped so a direct link
 * keeps working, and a doctor without a city is invisible to every
 * country-scoped browse.
 */
describe("country-scoped directory reads", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  const slugsOf = (res: { json(): unknown }) =>
    result<{ items: Array<{ slug: string }> }>(res).items.map((item) => item.slug);

  const feedSlugs = (res: { json(): unknown }) =>
    result<{
      slots: Array<{ kind: string; facility?: { slug: string }; doctor?: { slug: string } }>;
    }>(res).slots.map((slot) => slot.facility?.slug ?? slot.doctor?.slug);

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildDirectoryTestServer(tdb.connectionString);
    await app.ready();
    await seedBaseFixture(app);

    const fixture: Array<[string, unknown]> = [
      [
        "directory.upsertCountry",
        { slug: "iran", isoCode: "IR", name: { en: "Iran", ar: "إيران", ckb: "ئێران" } },
      ],
      ["directory.setCountryGating", { isoCode: "IR", status: "active" }],
      [
        "directory.upsertCity",
        { slug: "tehran", countrySlug: "iran", name: { en: "Tehran", ar: "طهران", ckb: "تاران" } },
      ],
      [
        "directory.upsertFacility",
        {
          slug: "erbil-scope-hospital",
          categorySlug: "hospital",
          citySlug: "erbil",
          name: { en: "Erbil Scope Hospital", ar: "مستشفى أربيل", ckb: "نەخۆشخانەی هەولێر" },
          tierRank: 1,
          tierExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        },
      ],
      [
        "directory.upsertFacility",
        {
          slug: "tehran-scope-hospital",
          categorySlug: "hospital",
          citySlug: "tehran",
          name: { en: "Tehran Scope Hospital", ar: "مستشفى طهران", ckb: "نەخۆشخانەی تاران" },
          tierRank: 1,
          tierExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        },
      ],
      [
        "directory.upsertDoctorProfile",
        {
          slug: "dr-erbil-scope",
          name: { en: "Dr. Erbil", ar: "د. أربيل", ckb: "د. هەولێر" },
          specialtyKey: "cardiology",
          citySlug: "erbil",
        },
      ],
      [
        "directory.upsertDoctorProfile",
        {
          slug: "dr-tehran-scope",
          name: { en: "Dr. Tehran", ar: "د. طهران", ckb: "د. تاران" },
          specialtyKey: "cardiology",
          citySlug: "tehran",
        },
      ],
      [
        "directory.upsertDoctorProfile",
        {
          slug: "dr-no-city-scope",
          name: { en: "Dr. Nowhere", ar: "د. بلا مدينة", ckb: "د. بێ شار" },
          specialtyKey: "cardiology",
        },
      ],
    ];
    for (const [procedure, input] of fixture) {
      const res = await trpc(app, procedure, "mutation", input, ADMIN);
      expect(res.statusCode, procedure).toBe(200);
    }
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("browseFacilities serves the request country only", async () => {
    const iq = await trpc(
      app,
      "directory.browseFacilities",
      "query",
      { categorySlug: "hospital", limit: 12 },
      { country: "IQ" },
    );
    expect(iq.statusCode).toBe(200);
    expect(slugsOf(iq)).toEqual(["erbil-scope-hospital"]);

    const ir = await trpc(
      app,
      "directory.browseFacilities",
      "query",
      { categorySlug: "hospital", limit: 12 },
      { country: "IR" },
    );
    expect(ir.statusCode).toBe(200);
    expect(slugsOf(ir)).toEqual(["tehran-scope-hospital"]);
  });

  it("browseDoctors serves the request country only and excludes city-less doctors", async () => {
    const iq = await trpc(
      app,
      "directory.browseDoctors",
      "query",
      { limit: 12 },
      { country: "IQ" },
    );
    expect(iq.statusCode).toBe(200);
    expect(slugsOf(iq)).toEqual(["dr-erbil-scope"]);

    const ir = await trpc(
      app,
      "directory.browseDoctors",
      "query",
      { limit: 12 },
      { country: "IR" },
    );
    expect(ir.statusCode).toBe(200);
    expect(slugsOf(ir)).toEqual(["dr-tehran-scope"]);

    // The city-less doctor belongs to no country and surfaces in neither.
    expect([...slugsOf(iq), ...slugsOf(ir)]).not.toContain("dr-no-city-scope");
  });

  it("homepageFeed fills from the request country only", async () => {
    const iq = await trpc(app, "directory.homepageFeed", "query", { limit: 8 }, { country: "IQ" });
    expect(iq.statusCode).toBe(200);
    expect(feedSlugs(iq)).toContain("erbil-scope-hospital");
    expect(feedSlugs(iq)).not.toContain("tehran-scope-hospital");

    const ir = await trpc(app, "directory.homepageFeed", "query", { limit: 8 }, { country: "IR" });
    expect(ir.statusCode).toBe(200);
    expect(feedSlugs(ir)).toContain("tehran-scope-hospital");
    expect(feedSlugs(ir)).not.toContain("erbil-scope-hospital");
  });

  it("detail procedures stay reachable from any active country", async () => {
    const cases: Array<[string, string, string]> = [
      ["directory.facilityDetail", "tehran-scope-hospital", "IQ"],
      ["directory.facilityDetail", "erbil-scope-hospital", "IR"],
      ["directory.doctorDetail", "dr-tehran-scope", "IQ"],
      ["directory.doctorDetail", "dr-no-city-scope", "IQ"],
    ];
    for (const [procedure, slugOrId, country] of cases) {
      const res = await trpc(app, procedure, "query", { slugOrId }, { country });
      expect(res.statusCode, `${procedure} ${slugOrId} @ ${country}`).toBe(200);
    }
  });
});
