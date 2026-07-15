import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { ADMIN, buildDirectoryTestServer, seedBaseFixture, trpc } from "./helpers.js";

/**
 * Per-command role-guard denial matrix for the directory router (§3.6
 * layer a) plus invariant-violation coverage (§3.12: happy paths live in
 * browse/gating/search suites; denial + invariant proven here per command).
 */
describe("directory router authz matrix", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildDirectoryTestServer(tdb.connectionString);
    await app.ready();
    await seedBaseFixture(app);
  });

  afterAll(async () => {
    // Optional-chained: if beforeAll failed partway these are undefined, and
    // a secondary TypeError here would mask the real provisioning error
    // (exactly what hid the ADR-0021 flake's cause).
    await app?.close();
    await tdb?.close();
  });

  const ADMIN_COMMANDS: Array<[string, unknown]> = [
    ["upsertCountry", { slug: "x", isoCode: "XX", name: { en: "X", ar: "س", ckb: "خ" } }],
    ["setCountryGating", { isoCode: "XX", status: "active" }],
    ["upsertCity", { slug: "x", countrySlug: "iraq", name: { en: "X", ar: "س", ckb: "خ" } }],
    ["upsertCategory", { slug: "x", name: { en: "X", ar: "س", ckb: "خ" } }],
    ["upsertSpecialty", { key: "x", name: { en: "X", ar: "س", ckb: "خ" } }],
    ["upsertSymptom", { slug: "x", name: { en: "X", ar: "س", ckb: "خ" }, specialties: [] }],
    [
      "upsertProcedure",
      { slug: "x", name: { en: "X", ar: "س", ckb: "خ" }, specialtyKey: "cardiology" },
    ],
    ["upsertSectionType", { key: "x", label: { en: "X", ar: "س", ckb: "خ" } }],
    ["setCategorySectionTypes", { categorySlug: "hospital", sectionTypeKeys: [] }],
    ["setTaxonomyStatus", { taxonomy: "specialty", key: "cardiology", active: true }],
    ["setSpecialtyFeatured", { key: "cardiology", featured: true }],
    [
      "upsertPromotion",
      { entityType: "facility", categorySlug: "hospital", entityRef: "x", citySlug: "erbil" },
    ],
    [
      "upsertFacility",
      {
        slug: "x",
        categorySlug: "hospital",
        citySlug: "erbil",
        name: { en: "X", ar: "س", ckb: "خ" },
      },
    ],
    [
      "upsertDoctorProfile",
      { slug: "x", name: { en: "X", ar: "س", ckb: "خ" }, specialtyKey: "cardiology" },
    ],
  ];

  for (const [procedure, input] of ADMIN_COMMANDS) {
    it(`directory.${procedure}: anonymous → 401 UNAUTHORIZED`, async () => {
      const res = await trpc(app, `directory.${procedure}`, "mutation", input);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.data.appCode).toBe("UNAUTHORIZED");
    });

    for (const role of ["patient", "doctor", "secretary"]) {
      it(`directory.${procedure}: ${role} → 403 FORBIDDEN`, async () => {
        const res = await trpc(app, `directory.${procedure}`, "mutation", input, { roles: role });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.data.appCode).toBe("FORBIDDEN");
      });
    }
  }

  it("rejects an unknown specialty key on procedures (invariant violation)", async () => {
    const res = await trpc(
      app,
      "directory.upsertProcedure",
      "mutation",
      { slug: "p", name: { en: "P", ar: "ب", ckb: "پ" }, specialtyKey: "does-not-exist" },
      ADMIN,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.appCode).toBe("VALIDATION");
  });

  it("rejects an unknown city on facilities (invariant violation)", async () => {
    const res = await trpc(
      app,
      "directory.upsertFacility",
      "mutation",
      {
        slug: "f",
        categorySlug: "hospital",
        citySlug: "atlantis",
        name: { en: "F", ar: "ف", ckb: "ف" },
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.appCode).toBe("NOT_FOUND");
  });

  it("rejects an unknown section type on facilities (invariant violation)", async () => {
    const res = await trpc(
      app,
      "directory.upsertFacility",
      "mutation",
      {
        slug: "f2",
        categorySlug: "hospital",
        citySlug: "erbil",
        name: { en: "F", ar: "ف", ckb: "ف" },
        sections: [{ sectionTypeKey: "nope", name: { en: "S", ar: "س", ckb: "س" } }],
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.appCode).toBe("VALIDATION");
  });

  it("rejects out-of-contract input with 400 (setTaxonomyStatus unknown taxonomy)", async () => {
    const res = await trpc(
      app,
      "directory.setTaxonomyStatus",
      "mutation",
      { taxonomy: "galaxy", key: "x", active: true },
      ADMIN,
    );
    expect(res.statusCode).toBe(400);
  });
});
