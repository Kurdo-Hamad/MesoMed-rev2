/**
 * Unified charge ledger commands (MM-PLAN-001 §5 Phase 6b, ADR-0009).
 *
 * Ledger discipline: rows are financial facts. `pending` may transition to
 * `settled` or `void`; a settled row is immutable (DB trigger, migration
 * 0006) and is corrected by a NEW reversal row (`refund`), never an
 * UPDATE. Every mutation emits its billing.charge_*.v1 event through the
 * outbox in the same transaction (§3.2). All money is integer minor units.
 */
import { addUtcMonths, isInTrial, trialEndsAt } from "@mesomed/domain/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { ChargePayer, ChargeReason, ChargeStatus, RateKind } from "@mesomed/contracts/billing";
import { resolveTrialDefaultMonths, type ConfigReader } from "@mesomed/config";
import {
  and,
  billingCharges,
  desc,
  eq,
  providerBillingConfig,
  type DbTransaction,
} from "@mesomed/db/modules/billing";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { requireActiveRate } from "./rate-config.js";

type ChargeRow = typeof billingCharges.$inferSelect;

export interface RecordChargeInput {
  payer: ChargePayer;
  reason: ChargeReason;
  providerId: string;
  bookingId?: string | null;
  subscriptionId?: string | null;
  patientProfileId?: string | null;
  amountMinor: number;
  currency: string;
  rateKind?: RateKind | null;
  rateValue?: number | null;
  rateBaseMinor?: number | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  idempotencyKey: string;
}

export interface RecordChargeResult {
  applied: boolean;
  chargeId: string | null;
}

/**
 * The single ledger-append path. Replays are no-ops at the database level
 * via EITHER unique constraint (idempotency key; booking/reason tuple;
 * subscription period tuple) — same targetless ON CONFLICT discipline as
 * the Phase 6 tier payments. The charge_recorded event is emitted only
 * when this call actually created the row.
 */
export async function recordCharge(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: RecordChargeInput,
): Promise<RecordChargeResult> {
  const inserted = await tx
    .insert(billingCharges)
    .values({
      payer: input.payer,
      reason: input.reason,
      providerId: input.providerId,
      bookingId: input.bookingId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      patientProfileId: input.patientProfileId ?? null,
      amountMinor: input.amountMinor,
      currency: input.currency,
      rateKind: input.rateKind ?? null,
      rateValue: input.rateValue ?? null,
      rateBaseMinor: input.rateBaseMinor ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: billingCharges.id });

  const charge = inserted[0];
  if (!charge) return { applied: false, chargeId: null };

  await outbox.emit(tx, {
    name: "billing.charge_recorded.v1",
    aggregateType: "billing_charge",
    aggregateId: charge.id,
    payload: {
      chargeId: charge.id,
      providerId: input.providerId,
      payer: input.payer,
      reason: input.reason,
      amountMinor: input.amountMinor,
      currency: input.currency,
      bookingId: input.bookingId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      status: "pending",
    },
  });

  return { applied: true, chargeId: charge.id };
}

/** The charge row, locked on this transaction; typed NOT_FOUND otherwise. */
async function lockCharge(tx: DbTransaction, chargeId: string): Promise<ChargeRow> {
  const [row] = await tx
    .select()
    .from(billingCharges)
    .where(eq(billingCharges.id, chargeId))
    .for("update");
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, `Unknown charge "${chargeId}"`);
  return row;
}

export interface SettleChargeInput {
  chargeId: string;
  gatewayId: string;
  /** The gateway's OPAQUE reference only — never instrument data. */
  gatewayChargeRef: string | null;
}

/** pending → settled, stamping the gateway settlement metadata. */
export async function settleCharge(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: SettleChargeInput,
): Promise<{ chargeId: string; status: ChargeStatus }> {
  const charge = await lockCharge(tx, input.chargeId);
  if (charge.status !== "pending") {
    throw new AppError(
      ErrorCode.INVALID_STATUS_TRANSITION,
      `Cannot settle a ${charge.status} charge`,
    );
  }
  await tx
    .update(billingCharges)
    .set({
      status: "settled",
      gatewayId: input.gatewayId,
      gatewayChargeRef: input.gatewayChargeRef,
      settledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(billingCharges.id, charge.id));

  await outbox.emit(tx, {
    name: "billing.charge_settled.v1",
    aggregateType: "billing_charge",
    aggregateId: charge.id,
    payload: {
      chargeId: charge.id,
      providerId: charge.providerId,
      payer: charge.payer,
      reason: charge.reason,
      amountMinor: charge.amountMinor,
      currency: charge.currency,
      gatewayId: input.gatewayId,
      gatewayChargeRef: input.gatewayChargeRef,
    },
  });
  return { chargeId: charge.id, status: "settled" };
}

/** pending → void: the accrual was wrong and nothing was collected. */
export async function voidCharge(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  chargeId: string,
): Promise<{ chargeId: string; status: ChargeStatus }> {
  const charge = await lockCharge(tx, chargeId);
  if (charge.status !== "pending") {
    throw new AppError(
      ErrorCode.INVALID_STATUS_TRANSITION,
      `Cannot void a ${charge.status} charge`,
    );
  }
  await tx
    .update(billingCharges)
    .set({ status: "void", updatedAt: new Date() })
    .where(eq(billingCharges.id, charge.id));

  await outbox.emit(tx, {
    name: "billing.charge_voided.v1",
    aggregateType: "billing_charge",
    aggregateId: charge.id,
    payload: {
      chargeId: charge.id,
      providerId: charge.providerId,
      payer: charge.payer,
      reason: charge.reason,
      amountMinor: charge.amountMinor,
      currency: charge.currency,
      kind: "void",
      reversalChargeId: null,
    },
  });
  return { chargeId: charge.id, status: "void" };
}

/**
 * Correct a SETTLED charge: a NEW reversal row (status `refunded`,
 * `reverses_charge_id` → the original) — the settled fact itself is never
 * touched (DB-enforced). At most one reversal per charge (partial unique).
 */
export async function refundCharge(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  chargeId: string,
): Promise<{ chargeId: string; reversalChargeId: string }> {
  const charge = await lockCharge(tx, chargeId);
  if (charge.status !== "settled") {
    throw new AppError(
      ErrorCode.INVALID_STATUS_TRANSITION,
      `Only settled charges can be refunded (charge is ${charge.status})`,
    );
  }
  const inserted = await tx
    .insert(billingCharges)
    .values({
      payer: charge.payer,
      reason: charge.reason,
      providerId: charge.providerId,
      bookingId: charge.bookingId,
      subscriptionId: charge.subscriptionId,
      patientProfileId: charge.patientProfileId,
      amountMinor: charge.amountMinor,
      currency: charge.currency,
      status: "refunded",
      rateKind: charge.rateKind,
      rateValue: charge.rateValue,
      rateBaseMinor: charge.rateBaseMinor,
      periodStart: charge.periodStart,
      periodEnd: charge.periodEnd,
      gatewayId: charge.gatewayId,
      gatewayChargeRef: charge.gatewayChargeRef,
      idempotencyKey: `refund:${charge.id}`,
      reversesChargeId: charge.id,
    })
    .onConflictDoNothing()
    .returning({ id: billingCharges.id });

  const reversal = inserted[0];
  if (!reversal) {
    throw new AppError(ErrorCode.CONFLICT, "Charge already has a reversal row");
  }

  await outbox.emit(tx, {
    name: "billing.charge_voided.v1",
    aggregateType: "billing_charge",
    aggregateId: charge.id,
    payload: {
      chargeId: charge.id,
      providerId: charge.providerId,
      payer: charge.payer,
      reason: charge.reason,
      amountMinor: charge.amountMinor,
      currency: charge.currency,
      kind: "refund",
      reversalChargeId: reversal.id,
    },
  });
  return { chargeId: charge.id, reversalChargeId: reversal.id };
}

export type AccrualOutcome =
  "accrued" | "trial_waived" | "already_accrued" | "not_due" | "not_applicable";

export interface AccrueSubscriptionFeeResult {
  outcome: AccrualOutcome;
  chargeId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * Accrue the next monthly subscription fee for a flat_monthly provider —
 * ONE calendar month per call, from the later of the fee-accrual start
 * (trial end, else config creation) and the last accrued period end.
 * Trial (per-provider override OR global default window) waives ONLY this
 * fee — never per-booking charges. Manual admin command in this phase;
 * Phase 7's scheduled work drives the same function from a pg-boss cron.
 */
export async function accrueSubscriptionFee(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  config: ConfigReader,
  providerId: string,
  now: Date = new Date(),
): Promise<AccrueSubscriptionFeeResult> {
  const [cfg] = await tx
    .select()
    .from(providerBillingConfig)
    .where(eq(providerBillingConfig.providerId, providerId))
    .for("update");
  if (!cfg) {
    throw new AppError(
      ErrorCode.BILLING_MODEL_NOT_CONFIGURED,
      `Provider "${providerId}" has no billing model`,
    );
  }
  if (cfg.model !== "flat_monthly") {
    return { outcome: "not_applicable", chargeId: null, periodStart: null, periodEnd: null };
  }

  const trialWindow = {
    trialOverride: cfg.trialEndsAt,
    anchor: cfg.createdAt,
    defaultMonths: await resolveTrialDefaultMonths(config),
  };
  if (isInTrial(now, trialWindow)) {
    return { outcome: "trial_waived", chargeId: null, periodStart: null, periodEnd: null };
  }
  const feeStart = trialEndsAt(trialWindow) ?? cfg.createdAt;

  const [last] = await tx
    .select({ periodEnd: billingCharges.periodEnd })
    .from(billingCharges)
    .where(
      and(eq(billingCharges.subscriptionId, cfg.id), eq(billingCharges.reason, "subscription_fee")),
    )
    .orderBy(desc(billingCharges.periodEnd))
    .limit(1);

  const periodStart =
    last?.periodEnd != null && last.periodEnd.getTime() > feeStart.getTime()
      ? last.periodEnd
      : feeStart;
  if (periodStart.getTime() > now.getTime()) {
    return { outcome: "not_due", chargeId: null, periodStart: null, periodEnd: null };
  }
  const periodEnd = addUtcMonths(periodStart, 1);

  const rate = await requireActiveRate(tx, cfg.category, "flat_monthly", "monthly_fee");
  if (rate.value === 0) {
    // A configured-free monthly fee accrues nothing — 0-amount rows are
    // forbidden by the ledger CHECK (a charge is always a real debt).
    return { outcome: "not_applicable", chargeId: null, periodStart: null, periodEnd: null };
  }
  const result = await recordCharge(tx, outbox, {
    payer: "provider",
    reason: "subscription_fee",
    providerId,
    subscriptionId: cfg.id,
    amountMinor: rate.value,
    currency: rate.currency,
    rateKind: "monthly_fee",
    rateValue: rate.value,
    periodStart,
    periodEnd,
    idempotencyKey: `subfee:${providerId}:${periodStart.toISOString()}`,
  });
  if (!result.applied) {
    return { outcome: "already_accrued", chargeId: null, periodStart, periodEnd };
  }
  return { outcome: "accrued", chargeId: result.chargeId, periodStart, periodEnd };
}
