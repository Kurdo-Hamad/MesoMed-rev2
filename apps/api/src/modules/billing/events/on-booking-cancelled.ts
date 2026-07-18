/**
 * Billing subscribers for booking.cancelled.v1 / booking.no_show.v1
 * (MM-PLAN-001 §5 Phase 6b) — the WIRED-BUT-DORMANT patient-charge path.
 *
 * Both handlers ALWAYS evaluate the provider's cancellation policy and
 * record the outcome (`billing_policy_evaluations`, one row per booking ×
 * trigger — the idempotency claim for everything downstream). What the
 * single global `billing.patient_collection_enabled` config flag gates is
 * COLLECTION only:
 *
 *   flag false (launch default, fail-closed on a missing row): nothing
 *   collectable is recorded, no patient charge row exists, no gateway is
 *   ever touched.
 *
 *   flag true: the same handler writes the patient charge row and routes
 *   it through the PaymentOrchestrator (country × patient_charge routing
 *   config) — activation is a config edit, ZERO code change.
 *
 * The cancellation instant comes from the booking module's published
 * `getAppointmentTransitionRef` (cancelled/no_show are terminal, so the
 * stored status_changed_at IS the transition instant — deterministic under
 * redelivery, unlike wall-clock time at delivery).
 */
import type { EventEnvelope, bookingCancelledV1, bookingNoShowV1 } from "@mesomed/contracts";
import { evaluateCancellationPolicy } from "@mesomed/domain/billing";
import { resolvePatientCollectionEnabled } from "@mesomed/config";
import {
  billingPolicyEvaluations,
  eq,
  providerCancellationPolicy,
  type DbTransaction,
} from "@mesomed/db/modules/billing";
import type { ConfigService } from "../../../kernel/config.js";
import type { EventHandlerFn } from "../../../kernel/events.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { getAppointmentTransitionRef } from "../../booking/queries/appointment-refs.js";
import {
  getProviderRefForDoctorProfile,
  type DoctorProviderRef,
} from "../../directory/queries/provider-refs.js";
import { recordCharge, settleCharge } from "../commands/charges.js";
import { resolveGateway, type PaymentGatewayRegistry } from "../shared.js";

export const ON_BOOKING_CANCELLED_HANDLER = "billing.evaluate-cancellation-policy";
export const ON_BOOKING_NO_SHOW_HANDLER = "billing.evaluate-no-show-policy";

export interface PolicyHandlerDeps {
  outbox: OutboxEmitter;
  config: ConfigService;
  gateways: PaymentGatewayRegistry;
}

interface BookingSnapshot {
  appointmentId: string;
  doctorProfileId: string;
  patientProfileId: string;
  startsAt: string;
}

function createPolicyHandler(
  deps: PolicyHandlerDeps,
  trigger: "cancellation" | "no_show",
): (payload: BookingSnapshot, tx: DbTransaction) => Promise<void> {
  return async (payload, tx) => {
    const ref = await getProviderRefForDoctorProfile(tx, payload.doctorProfileId);
    if (!ref) return; // Listing no longer exists — nothing to evaluate.

    const [policy] = await tx
      .select()
      .from(providerCancellationPolicy)
      .where(eq(providerCancellationPolicy.providerId, ref.providerId))
      .limit(1);

    const transition = await getAppointmentTransitionRef(tx, payload.appointmentId);
    const occurredAt = transition?.statusChangedAt ?? new Date();

    const evaluation = policy
      ? evaluateCancellationPolicy({
          policy,
          trigger,
          startsAt: new Date(payload.startsAt),
          occurredAt,
        })
      : ({ outcome: "no_policy", feeMinor: 0 } as const);

    const collectionEnabled = await resolvePatientCollectionEnabled(deps.config);

    // The evaluation row is the idempotency claim for this (booking,
    // trigger): a redelivery that finds it present does nothing further.
    const claimed = await tx
      .insert(billingPolicyEvaluations)
      .values({
        providerId: ref.providerId,
        bookingId: payload.appointmentId,
        trigger,
        outcome: evaluation.outcome,
        windowHoursSnapshot: policy?.freeCancellationWindowHours ?? null,
        feeMinor: evaluation.feeMinor,
        currency: policy?.currency ?? null,
        collectionEnabled,
      })
      .onConflictDoNothing()
      .returning({ id: billingPolicyEvaluations.id });
    const evaluationRow = claimed[0];
    if (!evaluationRow) return;

    // Dormant at launch: with the flag off, an applicable fee is recorded
    // as an EVALUATION OUTCOME only — no charge row, no gateway call.
    if (!collectionEnabled || evaluation.outcome !== "fee_applicable" || !policy) return;

    await collectPatientCharge(deps, tx, {
      trigger,
      ref,
      payload,
      feeMinor: evaluation.feeMinor,
      currency: policy.currency,
      evaluationRowId: evaluationRow.id,
    });
  };
}

async function collectPatientCharge(
  deps: PolicyHandlerDeps,
  tx: DbTransaction,
  input: {
    trigger: "cancellation" | "no_show";
    ref: DoctorProviderRef;
    payload: BookingSnapshot;
    feeMinor: number;
    currency: string;
    evaluationRowId: string;
  },
): Promise<void> {
  const reason = input.trigger === "cancellation" ? "cancellation_fee" : "no_show_fee";
  const recorded = await recordCharge(tx, deps.outbox, {
    payer: "patient",
    reason,
    providerId: input.ref.providerId,
    bookingId: input.payload.appointmentId,
    patientProfileId: input.payload.patientProfileId,
    amountMinor: input.feeMinor,
    currency: input.currency,
    idempotencyKey: `patient-charge:${input.payload.appointmentId}:${reason}`,
  });
  if (!recorded.applied || recorded.chargeId === null) return;

  await tx
    .update(billingPolicyEvaluations)
    .set({ chargeId: recorded.chargeId })
    .where(eq(billingPolicyEvaluations.id, input.evaluationRowId));

  // Route through the PaymentOrchestrator like every other settlement —
  // fail-closed typed error if no gateway is routed for the provider's
  // country (retry → dead-letter: activation without routing must surface).
  if (input.ref.countryCode === null) return; // No routable country: leave the debt pending.
  const gateway = await resolveGateway(
    deps.config,
    deps.gateways,
    input.ref.countryCode,
    "patient_charge",
  );
  const initiation = await gateway.initiatePayment({
    idempotencyKey: `patient-charge:${input.payload.appointmentId}:${reason}`,
    kind: "patient_charge",
    amount: input.feeMinor,
    currency: input.currency,
    description: `Patient ${input.trigger} fee for booking ${input.payload.appointmentId}`,
  });
  if (initiation.status !== "settled") return; // Stays pending until the gateway confirms.

  await settleCharge(tx, deps.outbox, {
    chargeId: recorded.chargeId,
    gatewayId: gateway.id,
    gatewayChargeRef: initiation.reference,
  });
}

export function createOnBookingCancelled(deps: PolicyHandlerDeps): EventHandlerFn {
  const handle = createPolicyHandler(deps, "cancellation");
  return async (envelope, tx) => {
    const { payload } = envelope as EventEnvelope<typeof bookingCancelledV1>;
    await handle(payload, tx);
  };
}

export function createOnBookingNoShow(deps: PolicyHandlerDeps): EventHandlerFn {
  const handle = createPolicyHandler(deps, "no_show");
  return async (envelope, tx) => {
    const { payload } = envelope as EventEnvelope<typeof bookingNoShowV1>;
    await handle(payload, tx);
  };
}
