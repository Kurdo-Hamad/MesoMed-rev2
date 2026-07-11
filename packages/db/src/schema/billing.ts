import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
