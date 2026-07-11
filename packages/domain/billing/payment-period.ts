/**
 * Billing module — pure payment-period derivation (MM-PLAN-001 §5 Phase 6).
 *
 * Composes the ported `computeNewExpiry` (never reimplements its calendar
 * math): a payment covers the window from the current expiry when it is
 * still in the future — otherwise from now — to +N UTC calendar months.
 * The returned tuple is what `tier_payments` persists as
 * (period_start, period_end) and what the expiry column is extended to.
 */
import { computeNewExpiry } from "./tier-utils.js";

export interface PaymentPeriod {
  periodStart: Date;
  periodEnd: Date;
}

export function paymentPeriod(
  currentExpiry: Date | null | undefined,
  periods: number,
  now: Date = new Date(),
): PaymentPeriod {
  if (!Number.isInteger(periods) || periods < 1) {
    throw new Error(`Invalid periods ${periods}: must be a positive integer`);
  }
  const periodStart =
    currentExpiry != null && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  return { periodStart, periodEnd: computeNewExpiry(currentExpiry, periods, now) };
}
