/**
 * Billing revenue model — pure cancellation/no-show policy evaluation
 * (MM-PLAN-001 §5 Phase 6b).
 *
 * Evaluation is ALWAYS performed and recorded by the billing subscribers;
 * whether the resulting fee is actually collected from the patient is a
 * separate, globally config-gated concern (`patient_collection_enabled`,
 * dormant at launch) that this module knows nothing about.
 */

export type PolicyTrigger = "cancellation" | "no_show";

export interface CancellationPolicy {
  enabled: boolean;
  /** Cancelling at least this many hours before start is free. */
  freeCancellationWindowHours: number;
  cancellationFeeMinor: number;
  noShowFeeMinor: number;
}

export type PolicyOutcome =
  "policy_disabled" | "within_free_window" | "fee_zero" | "fee_applicable";

export interface PolicyEvaluation {
  outcome: PolicyOutcome;
  /** Minor units; 0 unless outcome = fee_applicable. */
  feeMinor: number;
}

export interface PolicyEvaluationInput {
  policy: CancellationPolicy;
  trigger: PolicyTrigger;
  /** Appointment start (UTC). */
  startsAt: Date;
  /** When the cancellation/no-show transition occurred (UTC). */
  occurredAt: Date;
}

const MS_PER_HOUR = 3_600_000;

export function evaluateCancellationPolicy(input: PolicyEvaluationInput): PolicyEvaluation {
  const { policy, trigger, startsAt, occurredAt } = input;
  if (
    !Number.isInteger(policy.freeCancellationWindowHours) ||
    policy.freeCancellationWindowHours < 0
  ) {
    throw new Error(
      `freeCancellationWindowHours must be a non-negative integer, got ${policy.freeCancellationWindowHours}`,
    );
  }
  if (!policy.enabled) return { outcome: "policy_disabled", feeMinor: 0 };

  if (trigger === "no_show") {
    return policy.noShowFeeMinor > 0
      ? { outcome: "fee_applicable", feeMinor: policy.noShowFeeMinor }
      : { outcome: "fee_zero", feeMinor: 0 };
  }

  // Cancelling at or before (start − window) is free; later cancellations
  // (including after the start instant) bear the fee.
  const hoursBeforeStart = (startsAt.getTime() - occurredAt.getTime()) / MS_PER_HOUR;
  if (hoursBeforeStart >= policy.freeCancellationWindowHours) {
    return { outcome: "within_free_window", feeMinor: 0 };
  }
  return policy.cancellationFeeMinor > 0
    ? { outcome: "fee_applicable", feeMinor: policy.cancellationFeeMinor }
    : { outcome: "fee_zero", feeMinor: 0 };
}
