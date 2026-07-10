/**
 * Identity module — guest-profile claim policy (pure).
 *
 * MM-DEC rev02 §2/§9: a phone-keyed guest profile is upgraded in place when
 * the registrant proves ownership (OTP-verified phone or verified email).
 * There is no unverified claim step, and a profile claimed by one user can
 * never be claimed by another.
 */

export type ClaimDecision =
  | { action: "claim" }
  | { action: "create" }
  | { action: "already-owned" }
  | { action: "reject"; reason: "owned-by-other" | "proof-not-verified" };

export interface ClaimInput {
  /** Whether ownership proof (OTP-verified phone / verified email) is established. */
  proofVerified: boolean;
  callerUserId: string;
  /** Current profile row for the normalized phone, or null if none exists. */
  profile: { userId: string | null } | null;
}

export function decideClaim({ proofVerified, callerUserId, profile }: ClaimInput): ClaimDecision {
  if (!proofVerified) return { action: "reject", reason: "proof-not-verified" };
  if (profile === null) return { action: "create" };
  if (profile.userId === null) return { action: "claim" };
  if (profile.userId === callerUserId) return { action: "already-owned" };
  return { action: "reject", reason: "owned-by-other" };
}
