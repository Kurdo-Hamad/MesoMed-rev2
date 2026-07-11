/**
 * Support-access grant policy (MM-PLAN-001 §3.5, §5 Phase 5): admin access
 * to visit-note content is time-boxed. Pure rules — the DB-side SECURITY
 * DEFINER function re-enforces usability independently; these functions
 * give the application layer the same answer with typed reasons.
 */

/** The longest window a support grant may be issued for. */
export const MAX_GRANT_WINDOW_MS = 72 * 60 * 60 * 1000;

export type GrantWindowVerdict =
  { ok: true } | { ok: false; reason: "expiry_not_in_future" | "window_too_long" };

/** Validate a requested expiry instant at grant-creation time. */
export function validateGrantWindow(now: Date, expiresAt: Date): GrantWindowVerdict {
  if (expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expiry_not_in_future" };
  }
  if (expiresAt.getTime() - now.getTime() > MAX_GRANT_WINDOW_MS) {
    return { ok: false, reason: "window_too_long" };
  }
  return { ok: true };
}

export interface GrantState {
  adminUserId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type GrantUseVerdict =
  { ok: true } | { ok: false; reason: "wrong_admin" | "revoked" | "expired" };

/** Whether `actorUserId` may use this grant at instant `now`. */
export function evaluateGrantUse(
  grant: GrantState,
  actorUserId: string,
  now: Date,
): GrantUseVerdict {
  if (grant.adminUserId !== actorUserId) return { ok: false, reason: "wrong_admin" };
  if (grant.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (now.getTime() >= grant.expiresAt.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}
