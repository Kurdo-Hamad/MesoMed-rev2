/**
 * Identity module event contracts (MM-PLAN-001 §5 Phase 2, MM-DEC rev02).
 * Versioned and additive-only per §3.3 — breaking change = new version.
 */
import { z } from "zod";
import { ROLES } from "../roles.js";
import { defineEvent } from "./index.js";

export const USER_TYPES = ["patient", "provider"] as const;

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
  roleAssignedV1,
  patientProfileCreatedV1,
  profileClaimedV1,
  providerStatusChangedV1,
  providerRecoveredV1,
] as const;
