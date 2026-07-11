/**
 * Prescription status model (clinical extension, ADR-0010). Content is
 * append-only per MM-PLAN-001 §3.5: an amendment is a NEW active row
 * superseding the prior revision, a discontinuation is a status flip with
 * no content change. The only legal transitions are therefore
 * active → superseded and active → discontinued — everything else is a
 * violation, re-enforced by the DB guard trigger in migration 0007.
 */

export const PRESCRIPTION_STATUSES = ["active", "superseded", "discontinued"] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export type PrescriptionTransitionVerdict =
  { ok: true } | { ok: false; reason: "not_active" | "illegal_target" };

/** Whether a revision in `from` may transition to `to`. */
export function validatePrescriptionTransition(
  from: PrescriptionStatus,
  to: PrescriptionStatus,
): PrescriptionTransitionVerdict {
  if (from !== "active") return { ok: false, reason: "not_active" };
  if (to !== "superseded" && to !== "discontinued") return { ok: false, reason: "illegal_target" };
  return { ok: true };
}
