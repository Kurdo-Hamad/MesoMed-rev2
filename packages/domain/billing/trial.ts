/**
 * Billing revenue model — pure trial-window evaluation (MM-PLAN-001 §5
 * Phase 6b).
 *
 * The free trial waives the SUBSCRIPTION/MONTHLY fee only; per-booking
 * charges (fee or commission) accrue from day one, including during trial.
 * Two knobs, both config-driven: a global default (months from the
 * provider's billing-config creation) and a per-provider `trial_ends_at`
 * override, which wins when present.
 */
import { addUtcMonths } from "./tier-utils.js";

export interface TrialWindowInput {
  /** Per-provider override; null → the global default applies. */
  trialOverride: Date | null;
  /** Anchor for the global default: billing-config creation instant. */
  anchor: Date;
  /** Global default in calendar months; 0 → no global trial. */
  defaultMonths: number;
}

/** The instant the provider's trial ends, or null when no trial applies. */
export function trialEndsAt(input: TrialWindowInput): Date | null {
  if (input.trialOverride !== null) return input.trialOverride;
  if (!Number.isInteger(input.defaultMonths) || input.defaultMonths < 0) {
    throw new Error(`defaultMonths must be a non-negative integer, got ${input.defaultMonths}`);
  }
  if (input.defaultMonths === 0) return null;
  return addUtcMonths(input.anchor, input.defaultMonths);
}

/** True while subscription-fee accrual is waived. */
export function isInTrial(now: Date, input: TrialWindowInput): boolean {
  const end = trialEndsAt(input);
  return end !== null && now.getTime() < end.getTime();
}
