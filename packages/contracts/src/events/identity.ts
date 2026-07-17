/**
 * Identity module event contracts (MM-PLAN-001 §5 Phase 2, MM-DEC rev02).
 * Versioned and additive-only per §3.3 — breaking change = new version.
 */
import { z } from "zod";
import { ROLES } from "../roles.js";
import { defineEvent } from "./index.js";

export const USER_TYPES = ["patient", "provider"] as const;

/**
 * MM-QA-004 F-04 (closes MM-QA-002 F-07): domain_events is retained
 * indefinitely, so contact PII must never persist there. New identity
 * schemas (v2 and later) are ids only, and all emit sites use v2.
 * The v1 schemas keep phone/email/normalizedPhone declared exactly as
 * shipped — owner ruling 2026-07-17 (ADR-0032): shipped contract
 * versions are never edited; they are the historical record of what
 * those rows contained. Migration 0010 alone redacts the stored data.
 */
export const userRegisteredV1 = defineEvent(
  "identity",
  "user_registered",
  1,
  z.object({
    userId: z.string(),
    userType: z.enum(USER_TYPES),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
);

export const userRegisteredV2 = defineEvent(
  "identity",
  "user_registered",
  2,
  z.object({
    userId: z.string(),
    userType: z.enum(USER_TYPES),
  }),
);

export const roleAssignedV1 = defineEvent(
  "identity",
  "role_assigned",
  1,
  z.object({
    userId: z.string(),
    role: z.enum(ROLES),
  }),
);

export const patientProfileCreatedV1 = defineEvent(
  "identity",
  "patient_profile_created",
  1,
  z.object({
    profileId: z.string(),
    normalizedPhone: z.string(),
    source: z.enum(["guest_booking", "registration"]),
  }),
);

export const patientProfileCreatedV2 = defineEvent(
  "identity",
  "patient_profile_created",
  2,
  z.object({
    profileId: z.string(),
    source: z.enum(["guest_booking", "registration"]),
  }),
);

export const profileClaimedV1 = defineEvent(
  "identity",
  "profile_claimed",
  1,
  z.object({
    profileId: z.string(),
    userId: z.string(),
    proof: z.enum(["otp-verified-phone", "verified-email"]),
  }),
);

export const providerStatusChangedV1 = defineEvent(
  "identity",
  "provider_status_changed",
  1,
  z.object({
    providerProfileId: z.string(),
    userId: z.string(),
    from: z.enum(["pending", "approved", "rejected"]),
    to: z.enum(["pending", "approved", "rejected"]),
    changedBy: z.string(),
    reason: z.string().nullable(),
  }),
);

export const providerRecoveredV1 = defineEvent(
  "identity",
  "provider_recovered",
  1,
  z.object({
    providerProfileId: z.string(),
    userId: z.string(),
    recoveredBy: z.string(),
    reason: z.string(),
  }),
);

/**
 * Self-service account deletion (MM-QA-004 F-02): the subject erased their
 * account. Id-only — the subscriber (communication) deletes its own PII
 * rows keyed by these ids; `patientProfileId` is null for accounts that
 * never had a patient profile (e.g. providers). The identity module has
 * already anonymized the profile and deleted the Better Auth user before
 * this drains, so handlers must key off ids alone.
 */
export const accountDeletedV1 = defineEvent(
  "identity",
  "account_deleted",
  1,
  z.object({
    userId: z.string(),
    patientProfileId: z.string().nullable(),
  }),
);

/**
 * v2 (MM-QA-004 F-02 close-out, ADR-0038): adds the provider-profile id so
 * the directory can retire a self-deleted provider's public listing — the
 * CASCADE that removes provider_profiles emits no event of its own, which
 * left an approved listing publicly bookable with no account behind it.
 * Still id-only. v1 stays registered for rows already emitted (ADR-0032:
 * shipped contract versions are never edited); all emit sites use v2.
 */
export const accountDeletedV2 = defineEvent(
  "identity",
  "account_deleted",
  2,
  z.object({
    userId: z.string(),
    patientProfileId: z.string().nullable(),
    providerProfileId: z.string().nullable(),
  }),
);

/** All identity event contracts, for registry composition in the API. */
export const IDENTITY_EVENTS = [
  userRegisteredV1,
  userRegisteredV2,
  roleAssignedV1,
  patientProfileCreatedV1,
  patientProfileCreatedV2,
  profileClaimedV1,
  providerStatusChangedV1,
  providerRecoveredV1,
  accountDeletedV1,
  accountDeletedV2,
] as const;
