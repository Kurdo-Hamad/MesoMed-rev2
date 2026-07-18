/**
 * Charge-ledger reads (MM-PLAN-001 §5 Phase 6b): providers read their own
 * accrued charges (myCharges, ownership-bound like mySubscription); admins
 * read any provider's ledger. Output instants are ISO strings.
 */
import type { z } from "zod";
import type { chargeSchema } from "@mesomed/contracts/billing";
import { billingCharges, desc, eq, type DbExecutor } from "@mesomed/db/modules/billing";

export type ChargeView = z.output<typeof chargeSchema>;

export async function listChargesForProvider(
  db: DbExecutor,
  providerId: string,
  limit: number,
): Promise<ChargeView[]> {
  const rows = await db
    .select()
    .from(billingCharges)
    .where(eq(billingCharges.providerId, providerId))
    .orderBy(desc(billingCharges.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    chargeId: row.id,
    payer: row.payer,
    reason: row.reason,
    providerId: row.providerId,
    bookingId: row.bookingId,
    subscriptionId: row.subscriptionId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    rateKind: row.rateKind,
    rateValue: row.rateValue,
    gatewayId: row.gatewayId,
    gatewayChargeRef: row.gatewayChargeRef,
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    reversesChargeId: row.reversesChargeId,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  }));
}
