import { describe, it, expect } from "vitest";
import {
  effectiveTierRank,
  computeNewExpiry,
  galleryCapForRank,
  DEFAULT_TIER_RANK,
} from "./tier-utils.js";

const NOW = new Date("2026-07-07T12:00:00Z");

describe("effectiveTierRank", () => {
  it("returns the stored rank while unexpired", () => {
    expect(effectiveTierRank(1, new Date("2026-08-01T00:00:00Z"), NOW)).toBe(1);
    expect(effectiveTierRank(2, new Date("2026-08-01T00:00:00Z"), NOW)).toBe(2);
  });

  it("demotes to tier_3 when expired", () => {
    expect(effectiveTierRank(1, new Date("2026-07-01T00:00:00Z"), NOW)).toBe(3);
    expect(effectiveTierRank(2, new Date("2026-07-07T12:00:00Z"), NOW)).toBe(3); // boundary: expiry == now
  });

  it("defaults to tier_3 with no tier at all", () => {
    expect(effectiveTierRank(null, null, NOW)).toBe(DEFAULT_TIER_RANK);
    expect(effectiveTierRank(undefined, undefined, NOW)).toBe(DEFAULT_TIER_RANK);
  });

  it("treats a rank with no expiry as unexpired", () => {
    expect(effectiveTierRank(1, null, NOW)).toBe(1);
  });
});

describe("computeNewExpiry", () => {
  it("extends from a future expiry", () => {
    const current = new Date("2026-08-15T00:00:00Z");
    expect(computeNewExpiry(current, 1, NOW).toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("starts from now when expiry is past or absent", () => {
    expect(computeNewExpiry(new Date("2026-06-01T00:00:00Z"), 1, NOW).toISOString()).toBe(
      "2026-08-07T12:00:00.000Z",
    );
    expect(computeNewExpiry(null, 1, NOW).toISOString()).toBe("2026-08-07T12:00:00.000Z");
  });

  it("adds one month per period", () => {
    expect(computeNewExpiry(null, 3, NOW).toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("clamps end-of-month overflow", () => {
    const jan31 = new Date("2026-01-31T00:00:00Z");
    expect(computeNewExpiry(jan31, 1, new Date("2026-01-01T00:00:00Z")).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("rolls over year boundaries", () => {
    const dec = new Date("2026-12-10T00:00:00Z");
    expect(computeNewExpiry(dec, 2, NOW).toISOString()).toBe("2027-02-10T00:00:00.000Z");
  });
});

describe("galleryCapForRank", () => {
  it("maps ranks to caps 10/6/2", () => {
    expect(galleryCapForRank(1)).toBe(10);
    expect(galleryCapForRank(2)).toBe(6);
    expect(galleryCapForRank(3)).toBe(2);
  });

  it("treats out-of-range ranks conservatively", () => {
    expect(galleryCapForRank(0)).toBe(10); // sub-1 treated as top tier (cannot happen via DB unique rank)
    expect(galleryCapForRank(99)).toBe(2); // unknown high rank gets the smallest cap
  });
});
