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

/**
 * What a payment settles. Phase 6: a facility listing tier or a doctor
 * subscription. Phase 6b (additive): settlement of an accrued provider
 * charge, and collection of a patient cancellation/no-show charge (the
 * latter dormant behind `billing.patient_collection_enabled`).
 */
export const PAYMENT_KINDS = [
  "tier_payment",
  "subscription",
  "provider_charge",
  "patient_charge",
] as const;
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

// ═══════════════════════════════════════════════════════════════════════
// Phase 6b — billing revenue model (additive to the Phase 6 surface).
// Principle: model the FULL revenue shape; behavior not active at launch
// is wired-but-dormant behind config, never missing code.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Provider billing category — the vocabulary rates are keyed on. Mirrors
 * the directory's provider-type list (billing never joins directory
 * tables; the category is snapshotted onto the provider's billing config
 * by the assigning command).
 */
export const BILLING_CATEGORIES = [
  "doctor",
  "hospital",
  "laboratory",
  "pharmacy",
  "home_nursing",
  "dental_clinic",
  "beauty_center",
] as const;
export type BillingCategory = (typeof BILLING_CATEGORIES)[number];

/**
 * Directory provider types deliberately absent from BILLING_CATEGORIES:
 * their pricing is unsigned business input (open decision recorded in
 * ADR-0056). Assigning a billing config to one is a VALIDATION rejection
 * until pricing is signed off — excluded on purpose, never silently
 * missing. Adding a directory provider type means pricing it here or
 * listing it below.
 */
export const BILLING_EXCLUDED_PROVIDER_TYPES = [
  "hair_transplant",
  "weight_management",
  "physiotherapy",
] as const;

/** The subscription model every provider selects at registration. */
export const BILLING_MODELS = ["flat_monthly", "commission"] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];

/**
 * Rate kinds in `billing_rate_config` (category × model × kind → value).
 * Monetary kinds are integer MINOR currency units (IQD fils — floats are
 * forbidden anywhere money is represented); `commission_pct` is integer
 * BASIS POINTS (250 = 2.50%).
 */
export const RATE_KINDS = ["monthly_fee", "per_booking_fee", "commission_pct"] as const;
export type RateKind = (typeof RATE_KINDS)[number];

/** Legal (model, rate kind) combinations — everything else is VALIDATION. */
export const MODEL_RATE_KINDS: Record<BillingModel, readonly RateKind[]> = {
  flat_monthly: ["monthly_fee", "per_booking_fee"],
  commission: ["commission_pct"],
};

export const CHARGE_PAYERS = ["provider", "patient"] as const;
export type ChargePayer = (typeof CHARGE_PAYERS)[number];

export const CHARGE_REASONS = [
  "commission",
  "per_booking_fee",
  "subscription_fee",
  "cancellation_fee",
  "no_show_fee",
] as const;
export type ChargeReason = (typeof CHARGE_REASONS)[number];

export const CHARGE_STATUSES = ["pending", "settled", "void", "refunded"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const POLICY_TRIGGERS = ["cancellation", "no_show"] as const;
export type PolicyTrigger = (typeof POLICY_TRIGGERS)[number];

/**
 * Outcome of evaluating a provider's cancellation policy against a
 * cancelled/no-show booking. Recorded on every trigger regardless of the
 * `billing.patient_collection_enabled` flag — dormancy suppresses the
 * COLLECTION, never the evaluation record.
 */
export const POLICY_OUTCOMES = [
  "no_policy",
  "policy_disabled",
  "within_free_window",
  "fee_zero",
  "fee_applicable",
] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

/** Integer minor currency units (IQD fils). Never a float. */
export const amountMinorSchema = z.number().int().nonnegative();
/** Strictly positive minor units, for amounts that must charge something. */
export const positiveAmountMinorSchema = z.number().int().positive();
/** Commission percentage in basis points: 0..10000 (100%). */
export const basisPointsSchema = z.number().int().min(0).max(10_000);

// ── Rate config (admin; §3.9 — rates are data rows, never inline) ───────

export const setBillingRateInputSchema = z
  .object({
    category: z.enum(BILLING_CATEGORIES),
    model: z.enum(BILLING_MODELS),
    rateKind: z.enum(RATE_KINDS),
    /** Minor units for monetary kinds; basis points for commission_pct. */
    value: amountMinorSchema,
    currency: currencySchema,
    active: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    if (!MODEL_RATE_KINDS[input.model].includes(input.rateKind)) {
      ctx.addIssue({
        code: "custom",
        message: `Rate kind "${input.rateKind}" is not valid for model "${input.model}"`,
      });
    }
    if (input.rateKind === "commission_pct" && input.value > 10_000) {
      ctx.addIssue({ code: "custom", message: "commission_pct exceeds 10000 basis points" });
    }
  });

export const setBillingRateResultSchema = z.object({ id: z.string() });

export const billingRateSchema = z.object({
  category: z.enum(BILLING_CATEGORIES),
  model: z.enum(BILLING_MODELS),
  rateKind: z.enum(RATE_KINDS),
  value: z.number().int(),
  currency: z.string(),
  active: z.boolean(),
});

export const listBillingRatesInputSchema = z.object({
  category: z.enum(BILLING_CATEGORIES).optional(),
});

export const listBillingRatesOutputSchema = z.object({ rates: z.array(billingRateSchema) });

// ── Provider billing config (model selection; trial override) ───────────

export const setProviderBillingModelInputSchema = z
  .object({
    /** Directory provider id. Omitted → the session's own provider. */
    providerId: z.uuid().optional(),
    model: z.enum(BILLING_MODELS),
    /** Phase 6 ranking tier the provider holds — orthogonal to the model. */
    tierKey: z.string().min(1).max(50).nullish(),
    /**
     * Commission base: the provider's declared standard booking value in
     * minor units. Required when model = commission.
     */
    bookingValueMinor: positiveAmountMinorSchema.nullish(),
    /** Per-provider trial override (ISO instant). Admin-only field. */
    trialEndsAt: z.iso.datetime().nullish(),
  })
  .superRefine((input, ctx) => {
    if (input.model === "commission" && input.bookingValueMinor == null) {
      ctx.addIssue({
        code: "custom",
        message: "Commission model requires bookingValueMinor (the commission base)",
      });
    }
  });

export const providerBillingConfigSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  category: z.enum(BILLING_CATEGORIES),
  model: z.enum(BILLING_MODELS),
  tierKey: z.string().nullable(),
  bookingValueMinor: z.number().int().nullable(),
  /** The provider-level override; null → the global default window applies. */
  trialEndsAt: z.string().nullable(),
  /** Resolved trial end (override or global default), null → no trial. */
  effectiveTrialEndsAt: z.string().nullable(),
  createdAt: z.string(),
});

export const setProviderBillingModelResultSchema = z.object({
  id: z.string(),
  created: z.boolean(),
});

export const myBillingConfigOutputSchema = z.object({
  config: providerBillingConfigSchema.nullable(),
});

export const providerBillingConfigInputSchema = z.object({ providerId: z.uuid() });

// ── Cancellation / no-show policy (fully settable now; collection dormant) ──

export const setCancellationPolicyInputSchema = z.object({
  /** Directory provider id. Omitted → the session's own provider. */
  providerId: z.uuid().optional(),
  freeCancellationWindowHours: z.number().int().min(0).max(720),
  cancellationFeeMinor: amountMinorSchema,
  noShowFeeMinor: amountMinorSchema,
  currency: currencySchema,
  enabled: z.boolean(),
});

export const cancellationPolicySchema = z.object({
  providerId: z.string(),
  freeCancellationWindowHours: z.number().int(),
  cancellationFeeMinor: z.number().int(),
  noShowFeeMinor: z.number().int(),
  currency: z.string(),
  enabled: z.boolean(),
});

export const setCancellationPolicyResultSchema = z.object({ id: z.string() });

export const myCancellationPolicyOutputSchema = z.object({
  policy: cancellationPolicySchema.nullable(),
});

// ── Charge ledger ────────────────────────────────────────────────────────

export const chargeSchema = z.object({
  chargeId: z.string(),
  payer: z.enum(CHARGE_PAYERS),
  reason: z.enum(CHARGE_REASONS),
  providerId: z.string(),
  bookingId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  amountMinor: z.number().int(),
  currency: z.string(),
  status: z.enum(CHARGE_STATUSES),
  /** Rate snapshot taken at charge time (rate changes never rewrite history). */
  rateKind: z.enum(RATE_KINDS).nullable(),
  rateValue: z.number().int().nullable(),
  gatewayId: z.string().nullable(),
  gatewayChargeRef: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  reversesChargeId: z.string().nullable(),
  createdAt: z.string(),
  settledAt: z.string().nullable(),
});

export const myChargesInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});

export const chargesOutputSchema = z.object({ charges: z.array(chargeSchema) });

export const providerChargesInputSchema = z.object({
  providerId: z.uuid(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const settleChargeInputSchema = z.object({ chargeId: z.uuid() });

export const settleChargeResultSchema = z.object({
  chargeId: z.string(),
  status: z.enum(CHARGE_STATUSES),
  gatewayId: z.string(),
  gatewayChargeRef: z.string().nullable(),
});

export const voidChargeInputSchema = z.object({ chargeId: z.uuid() });

export const voidChargeResultSchema = z.object({
  chargeId: z.string(),
  status: z.enum(CHARGE_STATUSES),
});

export const refundChargeInputSchema = z.object({ chargeId: z.uuid() });

export const refundChargeResultSchema = z.object({
  chargeId: z.string(),
  reversalChargeId: z.string(),
});

// ── Subscription-fee accrual (manual command now; pg-boss cron Phase 7) ──

export const ACCRUAL_OUTCOMES = [
  "accrued",
  "trial_waived",
  "already_accrued",
  "not_due",
  "not_applicable",
] as const;
export type AccrualOutcome = (typeof ACCRUAL_OUTCOMES)[number];

export const accrueSubscriptionFeeInputSchema = z.object({ providerId: z.uuid() });

export const accrueSubscriptionFeeResultSchema = z.object({
  outcome: z.enum(ACCRUAL_OUTCOMES),
  chargeId: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
});

// ── Global billing config knobs (config rows, §3.9) ─────────────────────

export const setTrialDefaultInputSchema = z.object({
  /** Global free-trial default in calendar months; 0 disables the default. */
  months: z.number().int().min(0).max(24),
});

export const setTrialDefaultResultSchema = z.object({ ok: z.literal(true) });

export const setPatientCollectionEnabledInputSchema = z.object({ enabled: z.boolean() });

export const setPatientCollectionEnabledResultSchema = z.object({ ok: z.literal(true) });

export const registerPaymentGatewayInputSchema = z.object({
  /** Gateway id to add to the config-driven routable registry. */
  gateway: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/),
});

export const registerPaymentGatewayResultSchema = z.object({
  gateways: z.array(z.string()),
});
