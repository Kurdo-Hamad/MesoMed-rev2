/**
 * Idempotent tier-payment application (MM-PLAN-001 §5 Phase 6).
 *
 * `applyTierPayment` is the single settlement path — the admin `manual`
 * command and gateway webhook deliveries both land here, inside one
 * transaction that (a) inserts the payment ledger row guarded by BOTH
 * ported uniqueness constraints (idempotency key; facility/tier/period
 * tuple), (b) atomically extends billing's own `facility_tiers.
 * tier_expires_at`, and (c) emits billing.tier_payment_recorded.v1 through
 * the outbox (§3.2). A replay fails the insert silently and changes
 * NOTHING — no extension, no event.
 */
import { paymentPeriod } from "@mesomed/domain/billing";
import { eq, facilityTiers, tierPayments, type DbTransaction } from "@mesomed/db/modules/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { facilityExists } from "../../directory/queries/facility-refs.js";
import { requireActiveTier } from "../shared.js";

export interface ApplyTierPaymentInput {
  idempotencyKey: string;
  facilityId: string;
  tierKey: string;
  periods: number;
  amount: number;
  currency: string;
  gateway: string;
  reference: string | null;
  /** Admin user id, or "gateway:<id>" for webhook-recorded payments. */
  recordedBy: string;
}

export interface ApplyTierPaymentResult {
  applied: boolean;
  tierPaymentId: string | null;
  tierExpiresAt: string | null;
}

export async function applyTierPayment(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: ApplyTierPaymentInput,
): Promise<ApplyTierPaymentResult> {
  const tier = await requireActiveTier(tx, input.tierKey);
  if (!(await facilityExists(tx, input.facilityId))) {
    throw new AppError(ErrorCode.NOT_FOUND, `Unknown facility "${input.facilityId}"`);
  }

  // Serialize per facility: concurrent settlements queue here, so the
  // second computes its period from the first's committed expiry.
  const [state] = await tx
    .select()
    .from(facilityTiers)
    .where(eq(facilityTiers.facilityId, input.facilityId))
    .for("update");

  const { periodStart, periodEnd } = paymentPeriod(state?.tierExpiresAt ?? null, input.periods);

  const inserted = await tx
    .insert(tierPayments)
    .values({
      facilityId: input.facilityId,
      tierId: tier.id,
      idempotencyKey: input.idempotencyKey,
      periodStart,
      periodEnd,
      amount: input.amount,
      currency: input.currency,
      gateway: input.gateway,
      reference: input.reference,
      recordedBy: input.recordedBy,
    })
    // Targetless: EITHER unique constraint (idempotency key / period tuple)
    // makes the replay a documented no-op rather than an error (§ gate).
    .onConflictDoNothing()
    .returning({ id: tierPayments.id });

  const payment = inserted[0];
  if (!payment) {
    return {
      applied: false,
      tierPaymentId: null,
      tierExpiresAt: state?.tierExpiresAt.toISOString() ?? null,
    };
  }

  if (state) {
    await tx
      .update(facilityTiers)
      .set({ tierId: tier.id, tierExpiresAt: periodEnd, updatedAt: new Date() })
      .where(eq(facilityTiers.id, state.id));
  } else {
    await tx
      .insert(facilityTiers)
      .values({ facilityId: input.facilityId, tierId: tier.id, tierExpiresAt: periodEnd });
  }

  await outbox.emit(tx, {
    name: "billing.tier_payment_recorded.v1",
    aggregateType: "facility_tier",
    aggregateId: input.facilityId,
    payload: {
      tierPaymentId: payment.id,
      facilityId: input.facilityId,
      tierKey: tier.key,
      tierRank: tier.rank,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      tierExpiresAt: periodEnd.toISOString(),
    },
  });

  return {
    applied: true,
    tierPaymentId: payment.id,
    tierExpiresAt: periodEnd.toISOString(),
  };
}
