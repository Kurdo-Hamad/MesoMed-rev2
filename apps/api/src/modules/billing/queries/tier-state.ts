/**
 * Tier taxonomy + per-facility tier-state reads (§3.2: queries read
 * freely within the module's own tables).
 */
import {
  asc,
  desc,
  eq,
  facilityTiers,
  listingTiers,
  tierPayments,
  tierPrices,
} from "@mesomed/db/modules/billing";
import type { DbExecutor } from "@mesomed/db/modules/billing";

export interface TierListItem {
  key: string;
  rank: number;
  name: { en: string; ar: string; ckb: string };
  price: { amount: number; currency: string } | null;
}

/** Active tiers by rank, with the monthly price configured for `country`. */
export async function listTiers(db: DbExecutor, country: string): Promise<TierListItem[]> {
  const tiers = await db
    .select()
    .from(listingTiers)
    .where(eq(listingTiers.active, true))
    .orderBy(asc(listingTiers.rank));
  const items: TierListItem[] = [];
  for (const tier of tiers) {
    const prices = await db
      .select({
        amount: tierPrices.amount,
        currency: tierPrices.currency,
        countryCode: tierPrices.countryCode,
        active: tierPrices.active,
      })
      .from(tierPrices)
      .where(eq(tierPrices.tierId, tier.id));
    const match = prices.find((p) => p.countryCode === country.toUpperCase() && p.active);
    items.push({
      key: tier.key,
      rank: tier.rank,
      name: { en: tier.nameEn, ar: tier.nameAr, ckb: tier.nameCkb },
      price: match ? { amount: match.amount, currency: match.currency } : null,
    });
  }
  return items;
}

export interface FacilityTierState {
  facilityId: string;
  tierKey: string | null;
  tierRank: number | null;
  tierExpiresAt: string | null;
  payments: Array<{
    tierPaymentId: string;
    tierKey: string;
    periodStart: string;
    periodEnd: string;
    amount: number;
    currency: string;
    gateway: string;
    recordedBy: string;
    createdAt: string;
  }>;
}

export async function getFacilityTierState(
  db: DbExecutor,
  facilityId: string,
): Promise<FacilityTierState> {
  const [state] = await db
    .select({
      tierKey: listingTiers.key,
      tierRank: listingTiers.rank,
      tierExpiresAt: facilityTiers.tierExpiresAt,
    })
    .from(facilityTiers)
    .innerJoin(listingTiers, eq(listingTiers.id, facilityTiers.tierId))
    .where(eq(facilityTiers.facilityId, facilityId));

  const payments = await db
    .select({
      tierPaymentId: tierPayments.id,
      tierKey: listingTiers.key,
      periodStart: tierPayments.periodStart,
      periodEnd: tierPayments.periodEnd,
      amount: tierPayments.amount,
      currency: tierPayments.currency,
      gateway: tierPayments.gateway,
      recordedBy: tierPayments.recordedBy,
      createdAt: tierPayments.createdAt,
    })
    .from(tierPayments)
    .innerJoin(listingTiers, eq(listingTiers.id, tierPayments.tierId))
    .where(eq(tierPayments.facilityId, facilityId))
    .orderBy(desc(tierPayments.createdAt));

  return {
    facilityId,
    tierKey: state?.tierKey ?? null,
    tierRank: state?.tierRank ?? null,
    tierExpiresAt: state?.tierExpiresAt.toISOString() ?? null,
    payments: payments.map((p) => ({
      ...p,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      createdAt: p.createdAt.toISOString(),
    })),
  };
}
