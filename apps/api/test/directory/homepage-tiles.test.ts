import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  listCategoriesOutputSchema,
  listHomepageTilesOutputSchema,
  type HomepageTile,
} from "@mesomed/contracts/directory";
import { domainEvents, inArray } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { waitFor } from "../helpers.js";
import { ADMIN, buildDirectoryTestServer, result, seedBaseFixture, trpc } from "./helpers.js";

/**
 * Per-country homepage tiles and category gating (ADR-0055): both live in
 * config rows, never in code or table columns. Gating fails OPEN (a
 * category absent from the row is active) and display falls back to the
 * full active category list for an unlisted country — IQ is deliberately
 * unlisted, so its homepage keeps the pre-slice shape.
 */
describe("config-driven homepage tiles and category gating", () => {
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

  const tiles = async (country: string): Promise<HomepageTile[]> => {
    const res = await trpc(app, "directory.listHomepageTiles", "query", undefined, { country });
    expect(res.statusCode).toBe(200);
    return listHomepageTilesOutputSchema.parse(result(res));
  };

  const categories = async () => {
    const res = await trpc(app, "directory.listCategories", "query");
    expect(res.statusCode).toBe(200);
    return listCategoriesOutputSchema.parse(result(res)).categories;
  };

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildDirectoryTestServer(tdb.connectionString);
    await app.ready();
    await seedBaseFixture(app);

    // hospital (displayOrder 0) comes from the base fixture; these extend
    // the catalog with a deferred one and one that gets deactivated.
    const fixture: Array<[string, unknown]> = [
      [
        "directory.upsertCategory",
        {
          slug: "dental_clinic",
          name: { en: "Dental Clinics", ar: "عيادات الأسنان", ckb: "کلینیکی ددان" },
          iconKey: "tooth",
          displayOrder: 1,
        },
      ],
      [
        "directory.upsertCategory",
        {
          slug: "online_consultation",
          name: { en: "Online Consultation", ar: "استشارة عن بُعد", ckb: "ڕاوێژکاری ئۆنلاین" },
          iconKey: "video",
          displayOrder: 2,
        },
      ],
      [
        "directory.upsertCategory",
        {
          slug: "retired_category",
          name: { en: "Retired", ar: "متقاعد", ckb: "خانەنشین" },
          displayOrder: 3,
        },
      ],
      [
        "directory.setTaxonomyStatus",
        { taxonomy: "category", key: "retired_category", active: false },
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

  it("composes listCategories status fail-open while the gating row is absent", async () => {
    const rows = await categories();
    expect(rows.map((row) => row.slug)).toEqual([
      "hospital",
      "dental_clinic",
      "online_consultation",
    ]);
    expect(rows.every((row) => row.status === "active")).toBe(true);
  });

  it("serves every active category in display order for an unconfigured country", async () => {
    const iq = await tiles("IQ");
    expect(iq).toEqual([
      {
        kind: "category",
        slug: "hospital",
        name: expect.anything(),
        iconKey: "building-2",
        status: "active",
      },
      {
        kind: "category",
        slug: "dental_clinic",
        name: expect.anything(),
        iconKey: "tooth",
        status: "active",
      },
      {
        kind: "category",
        slug: "online_consultation",
        name: expect.anything(),
        iconKey: "video",
        status: "active",
      },
    ]);
  });

  it("serves the configured tile list in config order for a configured country", async () => {
    const setup: Array<[string, unknown]> = [
      [
        "directory.upsertCountry",
        { slug: "iran", isoCode: "IR", name: { en: "Iran", ar: "إيران", ckb: "ئێران" } },
      ],
      ["directory.setCountryGating", { isoCode: "IR", status: "active" }],
      ["directory.setCategoryGating", { slug: "online_consultation", status: "coming_soon" }],
      [
        "directory.setCategoryDisplay",
        {
          countryIso: "IR",
          // `doctors` is the reserved tile; `retired_category` is inactive
          // and `no_such_category` unknown — both skipped silently.
          tiles: [
            "doctors",
            "online_consultation",
            "retired_category",
            "no_such_category",
            "hospital",
          ],
        },
      ],
    ];
    for (const [procedure, input] of setup) {
      const res = await trpc(app, procedure, "mutation", input, ADMIN);
      expect(res.statusCode, procedure).toBe(200);
    }

    const ir = await tiles("IR");
    expect(ir).toEqual([
      { kind: "doctors" },
      {
        kind: "category",
        slug: "online_consultation",
        name: expect.anything(),
        iconKey: "video",
        status: "coming_soon",
      },
      {
        kind: "category",
        slug: "hospital",
        name: expect.anything(),
        iconKey: "building-2",
        status: "active",
      },
    ]);
  });

  it("composes the deferred status into listCategories once the gating row exists", async () => {
    // The taxonomy cache is busted by any directory event (ADR-0012); a
    // config row carries none, so a write is needed to observe the flip
    // before the TTL expires.
    const specialty = await trpc(
      app,
      "directory.upsertSpecialty",
      "mutation",
      { key: "dermatology", name: { en: "Dermatology", ar: "الجلدية", ckb: "پێست" } },
      ADMIN,
    );
    expect(specialty.statusCode).toBe(200);
    await drainOutbox();

    const rows = await categories();
    expect(rows.find((row) => row.slug === "online_consultation")?.status).toBe("coming_soon");
    expect(rows.find((row) => row.slug === "hospital")?.status).toBe("active");
  });

  it("gates the tile list behind country gating like every other public read", async () => {
    const res = await trpc(app, "directory.listHomepageTiles", "query", undefined, {
      country: "XX",
    });
    expect(res.statusCode).toBe(412);
    expect(res.json().error.data.appCode).toBe("COUNTRY_COMING_SOON");
  });
});
