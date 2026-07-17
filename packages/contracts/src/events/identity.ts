/**
 * Identity module event contracts (MM-PLAN-001 §5 Phase 2, MM-DEC rev02).
 * Versioned and additive-only per §3.3 — breaking change = new version.
 */
import { z } from "zod";
import { ROLES } from "../roles.js";
import { defineEvent } from "./index.js";

export const USER_TYPES = ["patient", "provider"] as const;

/**
 * Identity payloads are ids only, in every version (MM-QA-004 F-04,
 * closing MM-QA-002 F-07): domain_events is retained indefinitely, so
 * contact PII must never persist there. v1 originally carried
 * phone/email/normalizedPhone; migration 0010 redacted those keys from
 * every stored v1 row, and the v1 schemas below match the redacted
 * state (envelope parse is non-strict, so a not-yet-redacted payload
 * still parses — the extra keys strip). v1 stays registered read-only
 * for pre-0010 rows; all emit sites use v2.
 */
export const userRegisteredV1 = defineEvent(
  "identity",
  "user_registered",
  1,
  z.object({
    userId: z.string(),
    userType: z.enum(USER_TYPES),
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
] as const;
