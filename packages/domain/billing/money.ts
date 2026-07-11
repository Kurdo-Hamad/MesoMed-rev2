/**
 * Billing revenue model — pure money math (MM-PLAN-001 §5 Phase 6b).
 *
 * ALL monetary values are integer MINOR currency units (IQD fils); floats
 * are forbidden anywhere money is represented. Commission percentages are
 * integer BASIS POINTS (250 = 2.50%).
 *
 * Rounding rule (recorded in ADR-0009): commission math rounds HALF-UP on
 * the fractional minor unit — deterministic, direction-stable, and what a
 * paper invoice in the region would show. Implemented on BigInt so a large
 * base × 10000 basis points cannot lose integer precision.
 */

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer, got ${value}`);
  }
}

/**
 * The commission accrued on one completed booking: `baseMinor` (the
 * provider's declared booking value) × `commissionBasisPoints`, rounded
 * half-up to whole minor units.
 */
export function commissionMinor(baseMinor: number, commissionBasisPoints: number): number {
  assertNonNegativeInt(baseMinor, "baseMinor");
  assertNonNegativeInt(commissionBasisPoints, "commissionBasisPoints");
  if (commissionBasisPoints > 10_000) {
    throw new Error(`commissionBasisPoints must be ≤ 10000, got ${commissionBasisPoints}`);
  }
  // Half-up: floor((base × bp + 5000) / 10000). BigInt: base × bp may
  // exceed Number.MAX_SAFE_INTEGER long before base itself does.
  const rounded = (BigInt(baseMinor) * BigInt(commissionBasisPoints) + 5_000n) / 10_000n;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`commission result ${rounded} exceeds the safe integer range`);
  }
  return result;
}

export type ChargeModel = "flat_monthly" | "commission";

export interface BookingChargeInput {
  model: ChargeModel;
  /** flat_monthly: the per-booking fee in minor units. */
  perBookingFeeMinor?: number;
  /** commission: the rate in basis points. */
  commissionBasisPoints?: number;
  /** commission: the provider's declared booking value in minor units. */
  bookingValueMinor?: number;
}

export interface BookingCharge {
  reason: "per_booking_fee" | "commission";
  amountMinor: number;
}

/**
 * The provider-debt charge accrued by one completed platform booking under
 * the provider's subscription model. Trial NEVER affects this: per-booking
 * charges accrue from day one, including during trial.
 */
export function bookingChargeFor(input: BookingChargeInput): BookingCharge {
  if (input.model === "flat_monthly") {
    if (input.perBookingFeeMinor == null) {
      throw new Error("flat_monthly booking charge requires perBookingFeeMinor");
    }
    assertNonNegativeInt(input.perBookingFeeMinor, "perBookingFeeMinor");
    return { reason: "per_booking_fee", amountMinor: input.perBookingFeeMinor };
  }
  if (input.commissionBasisPoints == null || input.bookingValueMinor == null) {
    throw new Error(
      "commission booking charge requires commissionBasisPoints and bookingValueMinor",
    );
  }
  return {
    reason: "commission",
    amountMinor: commissionMinor(input.bookingValueMinor, input.commissionBasisPoints),
  };
}
