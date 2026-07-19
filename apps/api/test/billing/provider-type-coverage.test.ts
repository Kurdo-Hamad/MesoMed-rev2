import { describe, expect, it } from "vitest";
import { BILLING_CATEGORIES, BILLING_EXCLUDED_PROVIDER_TYPES } from "@mesomed/contracts/billing";
import { DIRECTORY_PROVIDER_TYPES } from "@mesomed/db";

/**
 * ADR-0056 gate closure. The directory vocabulary lives in packages/db and
 * the billing vocabulary in packages/contracts, which must not depend on
 * each other — apps/api is the first place both are in scope, so the
 * binding assertion lives here. Adding a directory provider type without
 * either pricing it or consciously listing it as unpriced fails CI, which
 * is exactly how hair_transplant reached production unpriced.
 */
describe("provider-type billing coverage (ADR-0056)", () => {
  it("accounts for every directory provider type as priced or deliberately unpriced", () => {
    const accountedFor = [...BILLING_CATEGORIES, ...BILLING_EXCLUDED_PROVIDER_TYPES].sort();
    expect(accountedFor).toEqual([...DIRECTORY_PROVIDER_TYPES].sort());
  });

  it("never both prices and excludes the same provider type", () => {
    const priced = new Set<string>(BILLING_CATEGORIES);
    for (const providerType of BILLING_EXCLUDED_PROVIDER_TYPES) {
      expect(priced.has(providerType)).toBe(false);
    }
  });
});
