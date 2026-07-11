import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Billing module tables (MM-PLAN-001 §5 Phase 6) — owned exclusively by
 * `apps/api/src/modules/billing` (§3.1). `doctorProfileId` (directory) and
 * `facilityId` (directory) are cross-module references stored without FK
 * constraints — billing never joins directory tables; directory learns of
 * billing state via billing.* events and mirrors it in its own columns.
 *
 * Billing owns its OWN tier expiry (`facility_tiers.tier_expires_at`),
 * extended atomically in the tier-payment transaction; the directory's
 * denormalized `facilities.tier_rank`/`tier_expires_at` copies follow
 * eventually via billing.tier_payment_recorded.v1 (§3.2/§3.4).
 *
 * Statuses are plain text + CHECK (no Postgres enums), matching the
 * directory precedent: evolving a status list is a data migration, not an
 * enum surgery (§3.9).
 */

// Kept in sync with SUBSCRIPTION_STATUSES in @mesomed/contracts/billing —
// not re-exported here so there is exactly one import site for the values.
const SUBSCRIPTION_STATUSES = ["active", "grace_period", "inactive"] as const;

/** Per-doctor flat monthly subscription — one row per doctor profile. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Directory doctor_profiles id (cross-module reference, no FK). */
    doctorProfileId: uuid("doctor_profile_id").notNull(),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("inactive"),
    /** Paid through this UTC instant; null until the first payment. */
    paidUntil: timestamp("paid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subscriptions_doctor_profile_unique").on(table.doctorProfileId),
    check(
      "subscriptions_status_check",
      sql`${table.status} in ('active', 'grace_period', 'inactive')`,
    ),
  ],
);

export const subscriptionPayments = pgTable(
  "subscription_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    /** Replay identity: a duplicate recording/delivery is a provable no-op. */
    idempotencyKey: text("idempotency_key").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Whole currency units (flat monthly × periods). */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    gateway: text("gateway").notNull(),
    /** Gateway-scoped payment reference for reconciliation. */
    reference: text("reference"),
    /** Admin user id, or "gateway:<id>" for webhook-recorded payments. */
    recordedBy: text("recorded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subscription_payments_idempotency_key_unique").on(table.idempotencyKey),
    index("subscription_payments_subscription_idx").on(table.subscriptionId, table.createdAt),
    check("subscription_payments_window_check", sql`${table.periodStart} < ${table.periodEnd}`),
    check("subscription_payments_amount_check", sql`${table.amount} > 0`),
  ],
);

/**
 * Listing-tier taxonomy: pure data rows (§3.9 — adding/renaming a tier is
 * a data change). `rank` drives the directory landing sort; 1 is highest.
 */
export const listingTiers = pgTable(
  "listing_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    rank: integer("rank").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("listing_tiers_key_unique").on(table.key),
    uniqueIndex("listing_tiers_rank_unique").on(table.rank),
    check("listing_tiers_rank_check", sql`${table.rank} >= 1`),
  ],
);

/** Tier pricing per country (§3.9: tier pricing = config-table rows). */
export const tierPrices = pgTable(
  "tier_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => listingTiers.id),
    /** ISO 3166-1 alpha-2 — billing never FKs into directory geography. */
    countryCode: text("country_code").notNull(),
    currency: text("currency").notNull(),
    /** Whole currency units per calendar month. */
    amount: integer("amount").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tier_prices_tier_country_unique").on(table.tierId, table.countryCode),
    check("tier_prices_amount_check", sql`${table.amount} > 0`),
  ],
);

/**
 * Billing's authoritative current-tier state per facility — the row whose
 * `tier_expires_at` a tier payment extends atomically in the same tx.
 */
export const facilityTiers = pgTable(
  "facility_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Directory facilities id (cross-module reference, no FK). */
    facilityId: uuid("facility_id").notNull(),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => listingTiers.id),
    tierExpiresAt: timestamp("tier_expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("facility_tiers_facility_unique").on(table.facilityId)],
);

/**
 * Idempotent tier-payment ledger — ports BOTH constraints from the old
 * schema: the replay key AND the (facility, tier, period) tuple, so a
 * duplicate webhook delivery and a double-recorded period are each no-ops
 * at the database level, not just in handler logic.
 */
export const tierPayments = pgTable(
  "tier_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Directory facilities id (cross-module reference, no FK). */
    facilityId: uuid("facility_id").notNull(),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => listingTiers.id),
    idempotencyKey: text("idempotency_key").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Whole currency units (monthly price × periods). */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    gateway: text("gateway").notNull(),
    reference: text("reference"),
    /** Admin user id, or "gateway:<id>" for webhook-recorded payments. */
    recordedBy: text("recorded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tier_payments_idempotency_key_unique").on(table.idempotencyKey),
    uniqueIndex("tier_payments_period_unique").on(
      table.facilityId,
      table.tierId,
      table.periodStart,
      table.periodEnd,
    ),
    index("tier_payments_facility_idx").on(table.facilityId, table.createdAt),
    check("tier_payments_window_check", sql`${table.periodStart} < ${table.periodEnd}`),
    check("tier_payments_amount_check", sql`${table.amount} > 0`),
  ],
);

// ═══════════════════════════════════════════════════════════════════════
// Phase 6b — billing revenue model (MM-PLAN-001 §5, ADR-0009).
//
// Governing principle: model the FULL revenue shape; dormant behavior is
// wired code behind config flags, never missing columns. Activating a
// deferred behavior must be a config edit — never ALTER TABLE.
//
// HARD SECURITY RULE: billing tables store charge FACTS and opaque gateway
// references ONLY. No payment-instrument data of any kind — no card/PAN,
// CVV, IBAN, account or routing numbers, and no tokens beyond the
// gateway's own opaque ref. There must be no column CAPABLE of holding an
// instrument (no jsonb/bytea free-form payloads in billing tables); a
// schema meta-test asserts this against information_schema.
//
// Money: integer MINOR currency units (IQD fils) in bigint columns —
// floats are forbidden anywhere money is represented. Commission
// percentages are integer basis points (250 = 2.50%).
// ═══════════════════════════════════════════════════════════════════════

// Kept in sync with the enums in @mesomed/contracts/billing — not
// re-exported here so there is exactly one import site for the values.
const BILLING_MODELS = ["flat_monthly", "commission"] as const;
const RATE_KINDS = ["monthly_fee", "per_booking_fee", "commission_pct"] as const;
const CHARGE_PAYERS = ["provider", "patient"] as const;
const CHARGE_REASONS = [
  "commission",
  "per_booking_fee",
  "subscription_fee",
  "cancellation_fee",
  "no_show_fee",
] as const;
const CHARGE_STATUSES = ["pending", "settled", "void", "refunded"] as const;
const POLICY_TRIGGERS = ["cancellation", "no_show"] as const;
const POLICY_OUTCOMES = [
  "no_policy",
  "policy_disabled",
  "within_free_window",
  "fee_zero",
  "fee_applicable",
] as const;

/**
 * Rate table (§3.9 config-over-code): category × model × rate_kind →
 * value. `value` is minor units for monetary kinds and basis points for
 * commission_pct. `category` is deliberately un-CHECKed text (the
 * vocabulary is validated by the Zod contract at the admin command):
 * extending the category vocabulary must not need a migration.
 */
export const billingRateConfig = pgTable(
  "billing_rate_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: text("category").notNull(),
    model: text("model", { enum: BILLING_MODELS }).notNull(),
    rateKind: text("rate_kind", { enum: RATE_KINDS }).notNull(),
    /** Minor units for monetary kinds; basis points for commission_pct. */
    value: bigint("value", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_rate_config_key_unique").on(table.category, table.model, table.rateKind),
    check("billing_rate_config_model_check", sql`${table.model} in ('flat_monthly', 'commission')`),
    check(
      "billing_rate_config_rate_kind_check",
      sql`${table.rateKind} in ('monthly_fee', 'per_booking_fee', 'commission_pct')`,
    ),
    check("billing_rate_config_value_check", sql`${table.value} >= 0`),
    check(
      "billing_rate_config_pct_bounds_check",
      sql`${table.rateKind} <> 'commission_pct' or ${table.value} <= 10000`,
    ),
    check(
      "billing_rate_config_combo_check",
      sql`(${table.model} = 'flat_monthly' and ${table.rateKind} in ('monthly_fee', 'per_booking_fee'))
          or (${table.model} = 'commission' and ${table.rateKind} = 'commission_pct')`,
    ),
  ],
);

/**
 * The provider's selected revenue model — one row per directory provider
 * (cross-module reference, no FK). `category` is snapshotted from the
 * directory's provider type by the assigning command so rate resolution
 * never joins directory tables. `booking_value_minor` is the provider's
 * declared standard booking value — the commission base (ADR-0009).
 * `trial_ends_at` is the per-provider trial override; null → the global
 * `billing.trial` config default anchored on `created_at`.
 */
export const providerBillingConfig = pgTable(
  "provider_billing_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Directory providers id (cross-module reference, no FK). */
    providerId: uuid("provider_id").notNull(),
    category: text("category").notNull(),
    model: text("model", { enum: BILLING_MODELS }).notNull(),
    /** Phase 6 ranking tier held under this model — orthogonal to it. */
    tierId: uuid("tier_id").references(() => listingTiers.id),
    /** Commission base in minor units; required when model = commission. */
    bookingValueMinor: bigint("booking_value_minor", { mode: "number" }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_billing_config_provider_unique").on(table.providerId),
    check(
      "provider_billing_config_model_check",
      sql`${table.model} in ('flat_monthly', 'commission')`,
    ),
    check(
      "provider_billing_config_commission_base_check",
      sql`${table.model} <> 'commission' or ${table.bookingValueMinor} is not null`,
    ),
    check(
      "provider_billing_config_booking_value_check",
      sql`${table.bookingValueMinor} is null or ${table.bookingValueMinor} > 0`,
    ),
  ],
);

/**
 * Provider-configurable cancellation/no-show policy — fully stored and
 * settable NOW; whether an applicable fee is actually COLLECTED from the
 * patient is gated by the single global `billing.patient_collection_enabled`
 * config flag (default false — the dormant launch state).
 */
export const providerCancellationPolicy = pgTable(
  "provider_cancellation_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Directory providers id (cross-module reference, no FK). */
    providerId: uuid("provider_id").notNull(),
    /** Cancelling at least this many hours before start is free. */
    freeCancellationWindowHours: integer("free_cancellation_window_hours").notNull(),
    cancellationFeeMinor: bigint("cancellation_fee_minor", { mode: "number" }).notNull(),
    noShowFeeMinor: bigint("no_show_fee_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_cancellation_policy_provider_unique").on(table.providerId),
    check(
      "provider_cancellation_policy_window_check",
      sql`${table.freeCancellationWindowHours} >= 0`,
    ),
    check(
      "provider_cancellation_policy_fees_check",
      sql`${table.cancellationFeeMinor} >= 0 and ${table.noShowFeeMinor} >= 0`,
    ),
  ],
);

/**
 * Unified charge ledger — every amount the platform is owed (or, when
 * patient collection activates, owes back). Only `payer = provider` rows
 * are written at launch; the patient path is wired and flag-gated.
 *
 * Settled rows are IMMUTABLE FACTS, enforced by a DB trigger (migration
 * 0006): the only legal UPDATE is pending → settled/void plus its
 * settlement metadata. Corrections to settled rows are NEW reversal rows
 * (`reverses_charge_id`), never UPDATEs to amount.
 */
export const billingCharges = pgTable(
  "billing_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payer: text("payer", { enum: CHARGE_PAYERS }).notNull(),
    reason: text("reason", { enum: CHARGE_REASONS }).notNull(),
    /** Directory providers id (cross-module reference, no FK). */
    providerId: uuid("provider_id").notNull(),
    /** Booking appointments id (cross-module reference, no FK). */
    bookingId: uuid("booking_id"),
    /** The provider's billing config the charge accrued under. */
    subscriptionId: uuid("subscription_id").references(() => providerBillingConfig.id),
    /** Identity patient profile owing a patient charge (no FK). */
    patientProfileId: uuid("patient_profile_id"),
    /** Integer minor currency units (IQD fils). Immutable once written. */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    /** ISO 4217 — explicit on every row money appears in. */
    currency: text("currency").notNull(),
    status: text("status", { enum: CHARGE_STATUSES }).notNull().default("pending"),
    /** Rate snapshot at charge time — rate edits never rewrite history. */
    rateKind: text("rate_kind", { enum: RATE_KINDS }),
    /** Minor units, or basis points when rate_kind = commission_pct. */
    rateValue: bigint("rate_value", { mode: "number" }),
    /** Commission base snapshot (the provider's booking value). */
    rateBaseMinor: bigint("rate_base_minor", { mode: "number" }),
    /** Coverage window for subscription_fee charges. */
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    /** Routable gateway id (config-driven registry — no enum, §3.9). */
    gatewayId: text("gateway_id"),
    /** The gateway's OPAQUE reference only — never instrument data. */
    gatewayChargeRef: text("gateway_charge_ref"),
    /** Replay identity (same discipline as Phase 6 tier payments). */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Set on reversal rows: the settled charge this row corrects. */
    reversesChargeId: uuid("reverses_charge_id").references((): AnyPgColumn => billingCharges.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_charges_idempotency_key_unique").on(table.idempotencyKey),
    /** One live charge per (booking, reason) — duplicate delivery is a no-op. */
    uniqueIndex("billing_charges_booking_reason_unique")
      .on(table.bookingId, table.reason)
      .where(sql`${table.bookingId} is not null and ${table.reversesChargeId} is null`),
    /** One subscription-fee accrual per (provider, period start). */
    uniqueIndex("billing_charges_subscription_period_unique")
      .on(table.providerId, table.periodStart)
      .where(sql`${table.reason} = 'subscription_fee' and ${table.reversesChargeId} is null`),
    /** At most one reversal row per corrected charge. */
    uniqueIndex("billing_charges_reversal_unique")
      .on(table.reversesChargeId)
      .where(sql`${table.reversesChargeId} is not null`),
    index("billing_charges_provider_idx").on(table.providerId, table.createdAt),
    check("billing_charges_payer_check", sql`${table.payer} in ('provider', 'patient')`),
    check(
      "billing_charges_reason_check",
      sql`${table.reason} in ('commission', 'per_booking_fee', 'subscription_fee', 'cancellation_fee', 'no_show_fee')`,
    ),
    check(
      "billing_charges_status_check",
      sql`${table.status} in ('pending', 'settled', 'void', 'refunded')`,
    ),
    check("billing_charges_amount_check", sql`${table.amountMinor} > 0`),
    /** Payer follows the reason: patient pays only cancellation/no-show fees. */
    check(
      "billing_charges_payer_reason_check",
      sql`(${table.reason} in ('cancellation_fee', 'no_show_fee') and ${table.payer} = 'patient')
          or (${table.reason} in ('commission', 'per_booking_fee', 'subscription_fee') and ${table.payer} = 'provider')`,
    ),
    /** Booking-driven reasons always carry their booking. */
    check(
      "billing_charges_booking_ref_check",
      sql`${table.reason} = 'subscription_fee' or ${table.bookingId} is not null`,
    ),
    /** Subscription fees always carry their coverage window. */
    check(
      "billing_charges_period_check",
      sql`${table.reason} <> 'subscription_fee'
          or (${table.periodStart} is not null and ${table.periodEnd} is not null and ${table.periodStart} < ${table.periodEnd})`,
    ),
    check(
      "billing_charges_rate_kind_check",
      sql`${table.rateKind} is null or ${table.rateKind} in ('monthly_fee', 'per_booking_fee', 'commission_pct')`,
    ),
  ],
);

/**
 * Cancellation/no-show policy evaluations — the record the dormant
 * patient-collection path leaves behind. One row per (booking, trigger);
 * `collection_enabled` snapshots the global flag at evaluation time, and
 * `charge_id` is set only when collection was active and a patient charge
 * row was actually written. Explicit columns only — no jsonb snapshot
 * (see the instrument-absence rule above).
 */
export const billingPolicyEvaluations = pgTable(
  "billing_policy_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Directory providers id (cross-module reference, no FK). */
    providerId: uuid("provider_id").notNull(),
    /** Booking appointments id (cross-module reference, no FK). */
    bookingId: uuid("booking_id").notNull(),
    trigger: text("trigger", { enum: POLICY_TRIGGERS }).notNull(),
    outcome: text("outcome", { enum: POLICY_OUTCOMES }).notNull(),
    /** Policy snapshot at evaluation time. */
    windowHoursSnapshot: integer("window_hours_snapshot"),
    feeMinor: bigint("fee_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency"),
    /** The global patient_collection_enabled flag at evaluation time. */
    collectionEnabled: boolean("collection_enabled").notNull(),
    chargeId: uuid("charge_id").references(() => billingCharges.id),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_policy_evaluations_booking_trigger_unique").on(
      table.bookingId,
      table.trigger,
    ),
    index("billing_policy_evaluations_provider_idx").on(table.providerId, table.evaluatedAt),
    check(
      "billing_policy_evaluations_trigger_check",
      sql`${table.trigger} in ('cancellation', 'no_show')`,
    ),
    check(
      "billing_policy_evaluations_outcome_check",
      sql`${table.outcome} in ('no_policy', 'policy_disabled', 'within_free_window', 'fee_zero', 'fee_applicable')`,
    ),
    check("billing_policy_evaluations_fee_check", sql`${table.feeMinor} >= 0`),
  ],
);
