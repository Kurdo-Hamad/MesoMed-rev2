/**
 * Billing module event contracts (MM-PLAN-001 §5 Phase 6). Versioned and
 * additive-only per §3.3.
 *
 * These events are the ONLY channel through which billing state reaches
 * other modules (§3.1): the directory subscribes and updates its own
 * denormalized read state (`providers.subscription_active`,
 * `facilities.tier_rank`/`tier_expires_at`) — billing never writes
 * directory tables and directory never joins billing tables.
 */
import { z } from "zod";
import { defineEvent } from "./index.js";

export const subscriptionActivatedV1 = defineEvent(
  "billing",
  "subscription_activated",
  1,
  z.object({
    subscriptionId: z.string(),
    /** Directory doctor-profile id (cross-module reference, no FK). */
    doctorProfileId: z.string(),
    /** UTC instant the subscription is paid through (ISO string). */
    paidUntil: z.string(),
  }),
);

/**
 * Emitted only on the transition to `inactive` — a subscription entering
 * its grace period retains public visibility and is not an integration
 * signal for the directory.
 */
export const subscriptionExpiredV1 = defineEvent(
  "billing",
  "subscription_expired",
  1,
  z.object({
    subscriptionId: z.string(),
    doctorProfileId: z.string(),
  }),
);

export const tierPaymentRecordedV1 = defineEvent(
  "billing",
  "tier_payment_recorded",
  1,
  z.object({
    tierPaymentId: z.string(),
    /** Directory facility id (cross-module reference, no FK). */
    facilityId: z.string(),
    tierKey: z.string(),
    /** Denormalized rank so subscribers never read billing tables. */
    tierRank: z.number().int(),
    /** UTC instants (ISO strings) — the paid window and resulting expiry. */
    periodStart: z.string(),
    periodEnd: z.string(),
    tierExpiresAt: z.string(),
  }),
);

/** All billing event contracts, for registry composition in the API. */
export const BILLING_EVENTS = [
  subscriptionActivatedV1,
  subscriptionExpiredV1,
  tierPaymentRecordedV1,
] as const;
