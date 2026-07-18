/**
 * Identity module API contracts (MM-DEC rev02, MM-PLAN-001 §5 Phase 2).
 * tRPC procedure I/O — the router must match these exactly (§3.12).
 */
import { z } from "zod";
import { ROLES } from "./roles.js";

export const PROVIDER_STATUSES = ["pending", "approved", "rejected"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/** Provider categories per MM-DEC rev02 §3 (secretaries/admins are roles, not provider types). */
export const PROVIDER_TYPES = [
  "doctor",
  "hospital",
  "laboratory",
  "pharmacy",
  "home_nursing",
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const CLAIM_PROOFS = ["otp-verified-phone", "verified-email"] as const;
export type ClaimProof = (typeof CLAIM_PROOFS)[number];

export const GENDERS = ["male", "female"] as const;

export const claimProfileInputSchema = z.object({
  /** Phone (any accepted spelling) locating the guest profile to claim. */
  phone: z.string().min(4).max(32),
});

export const claimProfileOutputSchema = z.object({
  profileId: z.string().uuid(),
  proof: z.enum(CLAIM_PROOFS),
});

export const completeProviderSignupInputSchema = z.object({
  providerType: z.enum(PROVIDER_TYPES),
  /** Operational/recovery phone — never an auth factor (MM-DEC rev02 §3). */
  phone: z.string().min(4).max(32),
});

export const completeProviderSignupOutputSchema = z.object({
  providerProfileId: z.string().uuid(),
  status: z.enum(PROVIDER_STATUSES),
});

export const providerStatusResponseSchema = z.object({
  providerProfileId: z.string().uuid(),
  providerType: z.enum(PROVIDER_TYPES),
  status: z.enum(PROVIDER_STATUSES),
  rejectionReason: z.string().nullable(),
});

export const listPendingProvidersOutputSchema = z.array(
  z.object({
    providerProfileId: z.string().uuid(),
    userId: z.string(),
    providerType: z.enum(PROVIDER_TYPES),
    email: z.string().nullable(),
    phone: z.string(),
    createdAt: z.string(),
  }),
);

export const setProviderStatusInputSchema = z.object({
  providerProfileId: z.string().uuid(),
  status: z.enum(["approved", "rejected"]),
  reason: z.string().max(2000).optional(),
});

export const setProviderStatusOutputSchema = z.object({
  providerProfileId: z.string().uuid(),
  status: z.enum(PROVIDER_STATUSES),
});

export const recoverProviderAccountInputSchema = z.object({
  providerProfileId: z.string().uuid(),
  newPassword: z.string().min(8).max(128),
  /** Mandatory justification — becomes the audit event payload. */
  reason: z.string().min(1).max(2000),
});

export const recoverProviderAccountOutputSchema = z.object({
  providerProfileId: z.string().uuid(),
  sessionsRevoked: z.boolean(),
});

export const meResponseSchema = z.object({
  userId: z.string(),
  roles: z.array(z.enum(ROLES)),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  patientProfile: z
    .object({
      id: z.string().uuid(),
      fullName: z.string(),
    })
    .nullable(),
  providerProfile: providerStatusResponseSchema.nullable(),
});

export const revokeOtherSessionsOutputSchema = z.object({
  revoked: z.boolean(),
});

/**
 * Self-service account deletion (MM-QA-004 F-02). No input: the procedure
 * always acts on the authenticated caller's own id — there is no id
 * parameter, so one account can never delete another (self-only by
 * construction). The erasure runbook's matrix disposition is executed
 * server-side (anonymize the patient profile, delete the Better Auth user
 * and sessions, prune notification_log via the account-deleted event).
 */
export const deleteAccountOutputSchema = z.object({
  deleted: z.boolean(),
});

/**
 * Provider password recovery by profile phone (MM-DEC rev02 §5, MM-QA-004
 * F-01). Providers sign in with email and carry their phone on the
 * identity provider profile (not the Better Auth user), so the phone leg
 * of the §5 chain (verified email → WhatsApp OTP → SMS) is these two
 * public procedures rather than the phone-number plugin's user-phone
 * reset. Responses never disclose whether the phone matched an account
 * (no enumeration); the OTP is single-use and short-lived, and a
 * successful reset revokes every session.
 */
export const requestProviderRecoveryOtpInputSchema = z.object({
  phone: z.string().min(5).max(20),
});

export const requestProviderRecoveryOtpOutputSchema = z.object({
  sent: z.boolean(),
});

export const resetProviderPasswordByOtpInputSchema = z.object({
  phone: z.string().min(5).max(20),
  code: z.string().min(4).max(12),
  newPassword: z.string().min(8).max(128),
});

export const resetProviderPasswordByOtpOutputSchema = z.object({
  reset: z.boolean(),
});
