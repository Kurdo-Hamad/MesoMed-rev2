import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { createDirectoryRouter } from "../../src/modules/directory/router.js";
import { ADMIN, buildDirectoryTestServer, seedBaseFixture, trpc } from "./helpers.js";

/**
 * Per-procedure role-guard denial matrix for the directory router (§3.6
 * layer a; MM-QA-004 F-07) with the enumeration pin proving the guardrail
 * itself: EVERY procedure must appear in the matrix, so a new procedure
 * cannot ship without denial coverage (HANDOFF-001 #14). Plus
 * invariant-violation coverage (§3.12: happy paths live in
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

  interface MatrixEntry {
    procedure: string;
    kind: "query" | "mutation";
    input?: unknown;
    /** Roles denied by the kernel role guard (layer a) → 403. */
    deniedRoles: string[];
    /** Public procedures assert the absence of an auth gate instead of 401. */
    access?: "public";
  }

  const ADMIN_ONLY = ["patient", "doctor", "secretary"];
  const PUBLIC = { deniedRoles: [], access: "public" as const };

  const MATRIX: MatrixEntry[] = [
    // ── Public reads (country-gated, never auth-gated) ─────────────────
    { procedure: "directory.listCountries", kind: "query", ...PUBLIC },
    { procedure: "directory.listCities", kind: "query", ...PUBLIC },
    { procedure: "directory.listCategories", kind: "query", ...PUBLIC },
    { procedure: "directory.listSpecialties", kind: "query", ...PUBLIC },
    { procedure: "directory.listSymptoms", kind: "query", ...PUBLIC },
    { procedure: "directory.listProcedures", kind: "query", ...PUBLIC },
    {
      procedure: "directory.browseFacilities",
      kind: "query",
      input: { categorySlug: "hospital" },
      ...PUBLIC,
    },
    { procedure: "directory.browseDoctors", kind: "query", input: {}, ...PUBLIC },
    {
      procedure: "directory.facilityDetail",
      kind: "query",
      input: { slugOrId: "no-such-facility" },
      ...PUBLIC,
    },
    {
      procedure: "directory.doctorDetail",
      kind: "query",
      input: { slugOrId: "no-such-doctor" },
      ...PUBLIC,
    },
    { procedure: "directory.homepageFeed", kind: "query", input: {}, ...PUBLIC },

    // ── Admin commands (§3.6 layer a: admin only) ──────────────────────
    {
      procedure: "directory.upsertCountry",
      kind: "mutation",
      input: { slug: "x", isoCode: "XX", name: { en: "X", ar: "س", ckb: "خ" } },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.setCountryGating",
      kind: "mutation",
      input: { isoCode: "XX", status: "active" },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.upsertCity",
      kind: "mutation",
      input: { slug: "x", countrySlug: "iraq", name: { en: "X", ar: "س", ckb: "خ" } },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.upsertCategory",
      kind: "mutation",
      input: { slug: "x", name: { en: "X", ar: "س", ckb: "خ" } },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.upsertSpecialty",
      kind: "mutation",
      input: { key: "x", name: { en: "X", ar: "س", ckb: "خ" } },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.upsertSymptom",
      kind: "mutation",
      input: { slug: "x", name: { en: "X", ar: "س", ckb: "خ" }, specialties: [] },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.upsertProcedure",
      kind: "mutation",
      input: { slug: "x", name: { en: "X", ar: "س", ckb: "خ" }, specialtyKey: "cardiology" },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.upsertSectionType",
      kind: "mutation",
      input: { key: "x", label: { en: "X", ar: "س", ckb: "خ" } },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.setCategorySectionTypes",
      kind: "mutation",
      input: { categorySlug: "hospital", sectionTypeKeys: [] },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.setTaxonomyStatus",
      kind: "mutation",
      input: { taxonomy: "specialty", key: "cardiology", active: true },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.setSpecialtyFeatured",
      kind: "mutation",
      input: { key: "cardiology", featured: true },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.upsertPromotion",
      kind: "mutation",
      input: {
        entityType: "facility",
        categorySlug: "hospital",
        entityRef: "x",
        citySlug: "erbil",
      },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.upsertFacility",
      kind: "mutation",
      input: {
        slug: "x",
        categorySlug: "hospital",
        citySlug: "erbil",
        name: { en: "X", ar: "س", ckb: "خ" },
      },
      deniedRoles: ADMIN_ONLY,
    },
    {
      procedure: "directory.upsertDoctorProfile",
      kind: "mutation",
      input: { slug: "x", name: { en: "X", ar: "س", ckb: "خ" }, specialtyKey: "cardiology" },
      deniedRoles: ADMIN_ONLY,
    },
  ];

  it("meta-test: EVERY directory procedure appears in the denial matrix", () => {
    const record = createDirectoryRouter()._def.procedures as Record<string, unknown>;
    const procedures = Object.keys(record)
      .map((name) => `directory.${name}`)
      .sort();
    expect(procedures).toEqual(MATRIX.map((e) => e.procedure).sort());
  });

  for (const entry of MATRIX) {
    if (entry.access === "public") {
      it(`${entry.procedure}: public — anonymous caller is not auth-gated`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input);
        expect([401, 403]).not.toContain(res.statusCode);
      });
    } else {
      it(`${entry.procedure}: anonymous → 401 UNAUTHORIZED`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input);
        expect(res.statusCode).toBe(401);
        expect(res.json().error.data.appCode).toBe("UNAUTHORIZED");
      });
    }

    for (const role of entry.deniedRoles) {
      it(`${entry.procedure}: ${role} → 403 FORBIDDEN`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input, { roles: role });
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
