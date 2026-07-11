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

// ── Phase 6b — unified charge ledger (additive; v1 contracts above are
// untouched per §3.3) ────────────────────────────────────────────────────

const chargeIdentitySchema = z.object({
  chargeId: z.string(),
  /** Directory provider id (cross-module reference, no FK). */
  providerId: z.string(),
  payer: z.enum(["provider", "patient"]),
  reason: z.enum([
    "commission",
    "per_booking_fee",
    "subscription_fee",
    "cancellation_fee",
    "no_show_fee",
  ]),
  /** Integer minor currency units (IQD fils) — never a float. */
  amountMinor: z.number().int(),
  currency: z.string(),
});

/** A charge was accrued onto the ledger (status pending, or settled when
 * recorded and collected in one step). */
export const chargeRecordedV1 = defineEvent(
  "billing",
  "charge_recorded",
  1,
  chargeIdentitySchema.extend({
    bookingId: z.string().nullable(),
    subscriptionId: z.string().nullable(),
    status: z.enum(["pending", "settled"]),
  }),
);

/** A pending charge settled through a gateway (or manual recording). */
export const chargeSettledV1 = defineEvent(
  "billing",
  "charge_settled",
  1,
  chargeIdentitySchema.extend({
    gatewayId: z.string(),
    /** The gateway's opaque reference only — never instrument data. */
    gatewayChargeRef: z.string().nullable(),
  }),
);

/**
 * A charge was corrected: `void` flips a pending row; `refund` records a
 * NEW reversal row against a settled one (settled rows are immutable
 * facts — corrections are rows, never UPDATEs).
 */
export const chargeVoidedV1 = defineEvent(
  "billing",
  "charge_voided",
  1,
  chargeIdentitySchema.extend({
    kind: z.enum(["void", "refund"]),
    /** The reversal row id when kind = refund. */
    reversalChargeId: z.string().nullable(),
  }),
);

/** All billing event contracts, for registry composition in the API. */
export const BILLING_EVENTS = [
  subscriptionActivatedV1,
  subscriptionExpiredV1,
  tierPaymentRecordedV1,
  chargeRecordedV1,
  chargeSettledV1,
  chargeVoidedV1,
] as const;
