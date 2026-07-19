import { describe, expect, it } from "vitest";
import {
  CATEGORY_GATING_STATUSES,
  DOCTORS_TILE_ID,
  categoryListItemSchema,
  homepageTileSchema,
  listHomepageTilesOutputSchema,
  setCategoryDisplayInputSchema,
  setCategoryGatingInputSchema,
} from "../src/directory.js";

describe("directory contracts (ADR-0055 multicountry catalog)", () => {
  it("category gating status universe matches country gating's", () => {
    expect(CATEGORY_GATING_STATUSES).toEqual(["active", "coming_soon"]);
  });

  it("category list items require a gating status", () => {
    const base = {
      id: "c1",
      slug: "laboratory",
      name: { en: "Laboratory", ar: "المختبر", ckb: "تاقیگە" },
      iconKey: "microscope",
      active: true,
      displayOrder: 4,
    };
    expect(categoryListItemSchema.parse({ ...base, status: "coming_soon" }).status).toBe(
      "coming_soon",
    );
    expect(() => categoryListItemSchema.parse(base)).toThrow();
    expect(() => categoryListItemSchema.parse({ ...base, status: "hidden" })).toThrow();
  });

  it("homepage tiles discriminate the reserved doctors tile from category tiles", () => {
    expect(DOCTORS_TILE_ID).toBe("doctors");
    const tiles = listHomepageTilesOutputSchema.parse([
      { kind: "doctors" },
      {
        kind: "category",
        slug: "hospital",
        name: { en: "Hospitals", ar: "المستشفيات", ckb: "نەخۆشخانەکان" },
        iconKey: null,
        status: "active",
      },
    ]);
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toEqual({ kind: "doctors" });
    // Category tiles carry the full display payload — a bare kind is rejected.
    expect(() => homepageTileSchema.parse({ kind: "category" })).toThrow();
    expect(() => homepageTileSchema.parse({ kind: "specialty" })).toThrow();
  });

  it("setCategoryGating accepts snake_case slugs and gating statuses only", () => {
    expect(
      setCategoryGatingInputSchema.parse({ slug: "medical_marketplace", status: "coming_soon" })
        .status,
    ).toBe("coming_soon");
    expect(() =>
      setCategoryGatingInputSchema.parse({ slug: "Medical-Marketplace", status: "coming_soon" }),
    ).toThrow();
    expect(() =>
      setCategoryGatingInputSchema.parse({ slug: "pharmacy", status: "disabled" }),
    ).toThrow();
  });

  it("setCategoryDisplay requires an ISO2 country and a non-empty tile list", () => {
    const parsed = setCategoryDisplayInputSchema.parse({
      countryIso: "IR",
      tiles: ["doctors", "hospital", "dental_clinic"],
    });
    expect(parsed.tiles[0]).toBe(DOCTORS_TILE_ID);
    expect(() =>
      setCategoryDisplayInputSchema.parse({ countryIso: "irn", tiles: ["hospital"] }),
    ).toThrow();
    expect(() => setCategoryDisplayInputSchema.parse({ countryIso: "IR", tiles: [] })).toThrow();
    expect(() =>
      setCategoryDisplayInputSchema.parse({ countryIso: "IR", tiles: ["Bad Slug"] }),
    ).toThrow();
  });
});
