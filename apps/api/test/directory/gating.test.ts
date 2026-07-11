import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { ADMIN, buildDirectoryTestServer, result, seedBaseFixture, trpc } from "./helpers.js";

/**
 * Phase 3 gate: country gating flips via config row only (§3.9). No module
 * code lists countries — the test proves a country unknown to any code
 * becomes servable by writing config data alone.
 */
describe("config-driven country gating", () => {
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

  const browse = (country: string) =>
    trpc(app, "directory.browseFacilities", "query", { categorySlug: "hospital" }, { country });

  it("serves an active country and gates an unlisted one as coming soon", async () => {
    const active = await browse("IQ");
    expect(active.statusCode).toBe(200);

    const gated = await browse("IR");
    expect(gated.statusCode).toBe(412);
    expect(gated.json().error.data.appCode).toBe("COUNTRY_COMING_SOON");
  });

  it("a config row flip alone brings a brand-new country live — zero code changes", async () => {
    // "XX" appears nowhere in code or seeds.
    const before = await browse("XX");
    expect(before.statusCode).toBe(412);

    const flip = await trpc(
      app,
      "directory.setCountryGating",
      "mutation",
      { isoCode: "XX", status: "active" },
      ADMIN,
    );
    expect(flip.statusCode).toBe(200);

    const after = await browse("XX");
    expect(after.statusCode).toBe(200);

    // And back: flipping to coming_soon re-gates it.
    await trpc(
      app,
      "directory.setCountryGating",
      "mutation",
      { isoCode: "XX", status: "coming_soon" },
      ADMIN,
    );
    const regated = await browse("XX");
    expect(regated.statusCode).toBe(412);
  });

  it("gates every public read surface, and search too", async () => {
    const surfaces: Array<[string, unknown]> = [
      ["directory.browseDoctors", {}],
      ["directory.facilityDetail", { slugOrId: "nope" }],
      ["directory.doctorDetail", { slugOrId: "nope" }],
      ["directory.homepageFeed", {}],
      ["search.listings", { query: "zheen" }],
    ];
    for (const [procedure, input] of surfaces) {
      const res = await trpc(app, procedure, "query", input, { country: "IR" });
      expect(res.statusCode, procedure).toBe(412);
      expect(res.json().error.data.appCode, procedure).toBe("COUNTRY_COMING_SOON");
    }
  });

  it("listCountries composes gating status from the config row", async () => {
    const res = await trpc(app, "directory.listCountries", "query");
    expect(res.statusCode).toBe(200);
    const { countries } = result<{ countries: Array<{ isoCode: string; status: string }> }>(res);
    const iraq = countries.find((country) => country.isoCode === "IQ");
    expect(iraq?.status).toBe("active");
  });
});
