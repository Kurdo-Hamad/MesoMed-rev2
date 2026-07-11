/**
 * Billing module API contracts (MM-PLAN-001 §5 Phase 6). Router I/O is
 * typed here so web/mobile share one source of truth (§3.11/§3.12).
 *
 * Instants on the wire are ISO strings (UTC). Amounts are whole currency
 * units (IQD has no circulating minor unit) as non-negative integers.
 */
import { z } from "zod";
import { localizedTextSchema } from "./events/directory.js";

// ── Shared payment vocabulary ────────────────────────────────────────────

/** What a payment settles: a facility listing tier or a doctor subscription. */
export const PAYMENT_KINDS = ["tier_payment", "subscription"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const SUBSCRIPTION_STATUSES = ["active", "grace_period", "inactive"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Client-supplied replay identity for a payment mutation. Retried or
 * redelivered requests carry the same key and are provably no-ops.
 */
export const idempotencyKeySchema = z.string().min(8).max(128);

const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "ISO 4217, uppercase")
  .describe("ISO 4217 currency code");

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, uppercase");

const periodsSchema = z.number().int().min(1).max(24);

// ── Listing tiers ────────────────────────────────────────────────────────

export const upsertListingTierInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/),
  rank: z.number().int().min(1).max(100),
  name: localizedTextSchema,
  active: z.boolean().default(true),
});

export const upsertListingTierResultSchema = z.object({
  id: z.string(),
  created: z.boolean(),
});

export const setTierPriceInputSchema = z.object({
  tierKey: z.string().min(1).max(50),
  countryCode: countryCodeSchema,
  currency: currencySchema,
  /** Whole currency units per calendar month. */
  amount: z.number().int().positive(),
  active: z.boolean().default(true),
});

export const setTierPriceResultSchema = z.object({ id: z.string() });

export const tierListItemSchema = z.object({
  key: z.string(),
  rank: z.number().int(),
  name: localizedTextSchema,
  /** Monthly price for the request's country, when one is configured. */
  price: z.object({ amount: z.number().int(), currency: z.string() }).nullable(),
});

export const listTiersOutputSchema = z.object({ tiers: z.array(tierListItemSchema) });

// ── Tier payments ────────────────────────────────────────────────────────

export const recordTierPaymentInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  facilityId: z.uuid(),
  tierKey: z.string().min(1).max(50),
  periods: periodsSchema.default(1),
});

export const recordTierPaymentResultSchema = z.object({
  /** False when the idempotency key or period tuple was already settled. */
  applied: z.boolean(),
  tierPaymentId: z.string().nullable(),
  tierExpiresAt: z.string().nullable(),
});

export const facilityTierStateInputSchema = z.object({ facilityId: z.uuid() });

export const facilityTierStateOutputSchema = z.object({
  facilityId: z.string(),
  tierKey: z.string().nullable(),
  tierRank: z.number().int().nullable(),
  tierExpiresAt: z.string().nullable(),
  payments: z.array(
    z.object({
      tierPaymentId: z.string(),
      tierKey: z.string(),
      periodStart: z.string(),
      periodEnd: z.string(),
      amount: z.number().int(),
      currency: z.string(),
      gateway: z.string(),
      recordedBy: z.string(),
      createdAt: z.string(),
    }),
  ),
});

// ── Subscriptions ────────────────────────────────────────────────────────

export const recordSubscriptionPaymentInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  doctorProfileId: z.uuid(),
  periods: periodsSchema.default(1),
  /** Whole currency units actually received (flat monthly × periods). */
  amount: z.number().int().positive(),
  currency: currencySchema,
});

export const recordSubscriptionPaymentResultSchema = z.object({
  applied: z.boolean(),
  subscriptionId: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  paidUntil: z.string().nullable(),
});

export const expireSubscriptionInputSchema = z.object({
  doctorProfileId: z.uuid(),
  /** True lapses into grace_period (still visible); false deactivates. */
  toGrace: z.boolean(),
});

export const expireSubscriptionResultSchema = z.object({
  subscriptionId: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
});

export const subscriptionStateSchema = z.object({
  subscriptionId: z.string(),
  doctorProfileId: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  paidUntil: z.string().nullable(),
});

/** `null` when the doctor has never been billed. */
export const mySubscriptionOutputSchema = z.object({
  subscription: subscriptionStateSchema.nullable(),
});

// ── Payment routing config (§3.9 — data, not code) ──────────────────────

export const setPaymentRoutingInputSchema = z.object({
  countryCode: countryCodeSchema,
  kind: z.enum(PAYMENT_KINDS),
  /** Registered gateway id (e.g. "manual", "fib", "zaincash"). */
  gateway: z.string().min(1).max(50),
});

export const setPaymentRoutingResultSchema = z.object({ ok: z.literal(true) });

// ── Payment webhooks ─────────────────────────────────────────────────────

/**
 * Platform-normalized webhook envelope, Zod-validated BEFORE any gateway
 * code runs (fixes the old codebase's unvalidated webhook body). Gateway
 * adapters whose providers post a different raw shape translate to this
 * envelope inside `handleWebhook` when those adapters land (§8 deferral);
 * signature verification is always the adapter's job.
 */
export const paymentWebhookBodySchema = z
  .strictObject({
    idempotencyKey: idempotencyKeySchema,
    reference: z.string().min(1).max(200),
    kind: z.enum(PAYMENT_KINDS),
    amount: z.number().int().positive(),
    currency: currencySchema,
    periods: periodsSchema.default(1),
    /** Required when kind = tier_payment. */
    facilityId: z.uuid().optional(),
    tierKey: z.string().min(1).max(50).optional(),
    /** Required when kind = subscription. */
    doctorProfileId: z.uuid().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind === "tier_payment" && (!body.facilityId || !body.tierKey)) {
      ctx.addIssue({
        code: "custom",
        message: "tier_payment requires facilityId and tierKey",
      });
    }
    if (body.kind === "subscription" && !body.doctorProfileId) {
      ctx.addIssue({
        code: "custom",
        message: "subscription requires doctorProfileId",
      });
    }
  });

export type PaymentWebhookBody = z.output<typeof paymentWebhookBodySchema>;

export const paymentWebhookResponseSchema = z.object({
  received: z.literal(true),
  /** False when the delivery was a replay the system had already settled. */
  applied: z.boolean(),
});
