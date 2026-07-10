import { describe, it, expect } from "vitest";
import { getEligibleHeroSlides } from "./slide-utils.js";
import type { HeroSlide, LocalizedAlt } from "./types.js";

// Helper to create a minimal test slide
function makeSlide(overrides: Partial<HeroSlide> = {}): HeroSlide {
  const defaultAlt: LocalizedAlt = {
    en: "Test image",
    ar: "صورة الاختبار",
    ckb: "وێنەی تێست",
  };

  return {
    id: crypto.randomUUID(),
    desktopImageUrl: "https://example.com/image.jpg",
    imageAlt: defaultAlt,
    priority: 0,
    displayOrder: 0,
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("getEligibleHeroSlides", () => {
  const now = new Date("2026-07-06T12:00:00Z");

  it("should exclude inactive slides", () => {
    const slides = [
      makeSlide({ active: true, id: "1" }),
      makeSlide({ active: false, id: "2" }),
      makeSlide({ active: true, id: "3" }),
    ];

    const result = getEligibleHeroSlides(slides, now);

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["1", "3"]);
  });

  it("should exclude slides before the start window", () => {
    const slides = [
      makeSlide({
        id: "1",
        startsAt: new Date("2026-07-07T00:00:00Z"),
      }),
      makeSlide({
        id: "2",
        startsAt: new Date("2026-07-05T00:00:00Z"),
      }),
    ];

    const result = getEligibleHeroSlides(slides, now);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2");
  });

  it("should exclude slides after the end window", () => {
    const slides = [
      makeSlide({
        id: "1",
        endsAt: new Date("2026-07-05T00:00:00Z"),
      }),
      makeSlide({
        id: "2",
        endsAt: new Date("2026-07-07T00:00:00Z"),
      }),
    ];

    const result = getEligibleHeroSlides(slides, now);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2");
  });

  it("should include slides with NULL start/end dates", () => {
    const slides = [
      makeSlide({
        id: "1",
        startsAt: null,
        endsAt: null,
      }),
      makeSlide({
        id: "2",
        startsAt: new Date("2026-07-01T00:00:00Z"),
        endsAt: new Date("2026-07-31T00:00:00Z"),
      }),
    ];

    const result = getEligibleHeroSlides(slides, now);

    expect(result).toHaveLength(2);
  });

  it("should exclude slides with mismatched city keys", () => {
    const slides = [
      makeSlide({
        id: "1",
        targetCityKey: "erbil",
      }),
      makeSlide({
        id: "2",
        targetCityKey: "duhok",
      }),
      makeSlide({
        id: "3",
        targetCityKey: null,
      }),
    ];

    const result = getEligibleHeroSlides(slides, now, "erbil");

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["1", "3"]);
  });

  it("should include slides with NULL city key (show to all cities)", () => {
    const slides = [
      makeSlide({
        id: "1",
        targetCityKey: null,
      }),
      makeSlide({
        id: "2",
        targetCityKey: "duhok",
      }),
    ];

    const cityKey = "erbil";
    const result = getEligibleHeroSlides(slides, now, cityKey);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("1");
  });

  it("should sort by priority DESC then displayOrder ASC", () => {
    const slides = [
      makeSlide({ id: "1", priority: 1, displayOrder: 1 }),
      makeSlide({ id: "2", priority: 2, displayOrder: 2 }),
      makeSlide({ id: "3", priority: 2, displayOrder: 1 }),
      makeSlide({ id: "4", priority: 1, displayOrder: 2 }),
    ];

    const result = getEligibleHeroSlides(slides, now);

    // Priority 2 first (higher), then 1
    // Within priority 2: displayOrder 1 before 2
    // Within priority 1: displayOrder 1 before 2
    expect(result.map((s) => s.id)).toEqual(["3", "2", "1", "4"]);
  });

  it("should handle empty slides array", () => {
    const result = getEligibleHeroSlides([], now);
    expect(result).toHaveLength(0);
  });

  it("should work without a city key (ignores city targeting)", () => {
    const slides = [
      makeSlide({ id: "1", targetCityKey: "erbil" }),
      makeSlide({ id: "2", targetCityKey: null }),
    ];

    const result = getEligibleHeroSlides(slides, now);

    // Only slide 2 should match (slide 1 has a city key but no cityKey was provided)
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2");
  });

  it("should handle combined filtering and sorting", () => {
    const slides = [
      makeSlide({
        id: "1",
        active: true,
        priority: 10,
        displayOrder: 1,
        targetCityKey: "erbil",
      }),
      makeSlide({
        id: "2",
        active: false,
        priority: 10,
        displayOrder: 1,
        targetCityKey: "erbil",
      }),
      makeSlide({
        id: "3",
        active: true,
        priority: 20,
        displayOrder: 2,
        targetCityKey: "duhok",
      }),
      makeSlide({
        id: "4",
        active: true,
        priority: 20,
        displayOrder: 1,
        targetCityKey: "erbil",
      }),
      makeSlide({
        id: "5",
        active: true,
        priority: 10,
        displayOrder: 2,
        targetCityKey: "erbil",
      }),
    ];

    const result = getEligibleHeroSlides(slides, now, "erbil");

    // Excluded: id=2 (inactive), id=3 (wrong city)
    // Remaining: id=1, id=4, id=5
    // Ordered: id=4 (priority 20), then id=1 (priority 10, displayOrder 1), then id=5 (priority 10, displayOrder 2)
    expect(result.map((s) => s.id)).toEqual(["4", "1", "5"]);
  });
});
