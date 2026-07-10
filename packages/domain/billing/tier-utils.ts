/**
 * Billing module — pure listing-tier helpers (MM-EXEC-003).
 * Module Owner: Billing Team
 *
 * No imports, no I/O: shared by TierService and the provider module's
 * FacilityService without creating a service-level import cycle.
 */

/** Lowest tier: the default rank for unassigned or expired listings. */
export const DEFAULT_TIER_RANK = 3;

export const TIER_KEYS = ["tier_1", "tier_2", "tier_3"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

/**
 * Read-time tier check (DECISIONS #91): an expired tier ranks/renders as
 * tier_3 without any cron. The stored facilities.tier_rank drives the
 * indexed landing sort; this function is what every read path uses to decide
 * badges, featured treatment and the gallery cap.
 */
export function effectiveTierRank(
  tierRank: number | null | undefined,
  tierExpiresAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (tierRank == null) return DEFAULT_TIER_RANK;
  if (tierExpiresAt != null && tierExpiresAt.getTime() <= now.getTime()) {
    return DEFAULT_TIER_RANK;
  }
  return tierRank;
}

/**
 * Expiry math for manual payment recording (spec §8): extend from the
 * current expiry when it is still in the future, otherwise from now;
 * +1 calendar month per period. Uses UTC calendar months with end-of-month
 * clamping (Jan 31 + 1 month = Feb 28/29), so a subscription can never gain
 * or lose days to timezone drift.
 */
export function computeNewExpiry(
  currentExpiry: Date | null | undefined,
  periods: number,
  now: Date = new Date(),
): Date {
  const base =
    currentExpiry != null && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  return addUtcMonths(base, periods);
}

function addUtcMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const targetMonth = m + months;
  // Clamp the day to the target month's length (handles 29/30/31-day months).
  const lastDay = new Date(Date.UTC(y, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      y,
      targetMonth,
      Math.min(d, lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** Gallery caps by rank (spec §7): tier_1=10, tier_2=6, tier_3=2. */
export function galleryCapForRank(rank: number): number {
  if (rank <= 1) return 10;
  if (rank === 2) return 6;
  return 2;
}
