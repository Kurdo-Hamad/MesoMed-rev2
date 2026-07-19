import { describe, expect, it } from "vitest";
import { BILLING_CATEGORIES, BILLING_EXCLUDED_PROVIDER_TYPES } from "../src/billing.js";

describe("billing categories (ADR-0056 unpriced provider types)", () => {
  it("pins the provider types deliberately left unpriced", () => {
    expect([...BILLING_EXCLUDED_PROVIDER_TYPES]).toEqual([
      "hair_transplant",
      "weight_management",
      "physiotherapy",
    ]);
  });

  it("keeps the priced and excluded vocabularies disjoint", () => {
    const priced = new Set<string>(BILLING_CATEGORIES);
    for (const providerType of BILLING_EXCLUDED_PROVIDER_TYPES) {
      expect(priced.has(providerType)).toBe(false);
    }
  });

  it("prices exactly the seven categories signed off at Phase 6b", () => {
    expect([...BILLING_CATEGORIES]).toEqual([
      "doctor",
      "hospital",
      "laboratory",
      "pharmacy",
      "home_nursing",
      "dental_clinic",
      "beauty_center",
    ]);
  });
});
