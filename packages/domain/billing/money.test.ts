import { describe, expect, it } from "vitest";
import { bookingChargeFor, commissionMinor } from "./money.js";

/**
 * Money math DoD (Phase 6b gate): integer minor units only, commission in
 * basis points, HALF-UP rounding on the fractional minor unit — the rule
 * recorded in ADR-0009.
 */
describe("commissionMinor", () => {
  it("computes exact commissions with no rounding needed", () => {
    // 25,000 IQD (in fils) at 10.00%
    expect(commissionMinor(25_000_000, 1_000)).toBe(2_500_000);
    // 100% and 0% edges
    expect(commissionMinor(123_456, 10_000)).toBe(123_456);
    expect(commissionMinor(123_456, 0)).toBe(0);
    expect(commissionMinor(0, 5_000)).toBe(0);
  });

  it("rounds half-up on the fractional minor unit", () => {
    // 1001 × 0.25% = 2.5025 → 3 (fraction ≥ .5 rounds up)
    expect(commissionMinor(1_001, 25)).toBe(3);
    // 999 × 0.25% = 2.4975 → 2 (fraction < .5 rounds down)
    expect(commissionMinor(999, 25)).toBe(2);
    // exactly .5 → up (the half-up tie rule): 2 × 2.5% = 0.05 → 0; use
    // 20 × 2.5% = 0.5 → 1
    expect(commissionMinor(20, 250)).toBe(1);
    // just below the tie: 19 × 2.5% = 0.475 → 0
    expect(commissionMinor(19, 250)).toBe(0);
  });

  it("survives bases whose product exceeds Number.MAX_SAFE_INTEGER", () => {
    // 4.5e15 fils × 9999bp — the intermediate product needs BigInt.
    const base = 4_500_000_000_000_000;
    expect(commissionMinor(base, 9_999)).toBe(4_499_550_000_000_000);
  });

  it("rejects floats, negatives and out-of-range percentages", () => {
    expect(() => commissionMinor(10.5, 100)).toThrow(/safe integer/);
    expect(() => commissionMinor(-1, 100)).toThrow(/safe integer/);
    expect(() => commissionMinor(100, 100.5)).toThrow(/safe integer/);
    expect(() => commissionMinor(100, -1)).toThrow(/safe integer/);
    expect(() => commissionMinor(100, 10_001)).toThrow(/10000/);
  });
});

describe("bookingChargeFor", () => {
  it("flat_monthly yields the configured per-booking fee", () => {
    expect(bookingChargeFor({ model: "flat_monthly", perBookingFeeMinor: 2_000_000 })).toEqual({
      reason: "per_booking_fee",
      amountMinor: 2_000_000,
    });
  });

  it("commission yields the rounded percentage of the booking value", () => {
    expect(
      bookingChargeFor({
        model: "commission",
        commissionBasisPoints: 750,
        bookingValueMinor: 25_000_000,
      }),
    ).toEqual({ reason: "commission", amountMinor: 1_875_000 });
  });

  it("fails loudly when the model's inputs are missing", () => {
    expect(() => bookingChargeFor({ model: "flat_monthly" })).toThrow(/perBookingFeeMinor/);
    expect(() => bookingChargeFor({ model: "commission", commissionBasisPoints: 100 })).toThrow(
      /bookingValueMinor/,
    );
  });
});
