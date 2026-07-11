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
