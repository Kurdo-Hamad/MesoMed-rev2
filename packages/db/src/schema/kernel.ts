import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Kernel-owned infrastructure tables. These are not business tables — they
 * belong to the shared kernel (outbox, idempotency, config; MM-PLAN-001 §2)
 * and are the only tables Phase 1 ships. Business modules own their tables
 * exclusively inside `apps/api/src/modules/*` from Phase 2 on (§3.1); this
 * package re-exports them as the schema hub.
 */

export const OUTBOX_STATUSES = ["pending", "published", "processed", "dead"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/**
 * Transactional outbox (MM-PLAN-001 §3.2): commands insert here in the same
 * transaction as their state mutation; the kernel dispatcher publishes rows
 * to pg-boss and tracks delivery. Lifecycle:
 * pending → published (handed to the queue) → processed | dead.
 */
export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    status: text("status", { enum: OUTBOX_STATUSES }).notNull().default("pending"),
    lastError: text("last_error"),
  },
  (table) => [
    // The dispatcher's poll query: pending rows in arrival order.
    index("domain_events_status_occurred_at_idx").on(table.status, table.occurredAt),
    check(
      "domain_events_status_check",
      sql`${table.status} in ('pending', 'published', 'processed', 'dead')`,
    ),
  ],
);

/**
 * Idempotent-delivery ledger: one row per (event, handler) that completed.
 * The dispatcher claims the row in the same transaction as the handler's
 * own writes, so a re-delivered event id is a provable no-op per handler.
 */
export const processedEvents = pgTable(
  "processed_events",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => domainEvents.id, { onDelete: "cascade" }),
    handler: text("handler").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.handler] })],
);

/**
 * Config-over-code rows (MM-PLAN-001 §3.9), read through the kernel config
 * service's Zod-validated loader. Values are opaque JSON here; each key's
 * schema lives with its consumer.
 */
export const configEntries = pgTable("config_entries", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Abuse-guard infrastructure (MM-PLAN-001 §5 Phase 7, MM-ARC-002 §6.6) ──
// Shared kernel guardrails: the identity OTP path and the communication
// sender both enforce spend budgets, send-rate windows and velocity
// alerting through these tables, so they live with the kernel like the
// outbox — they are delivery plumbing, not module business data.

/**
 * Per-channel daily send counter backing the spend-budget guardrail.
 * One row per (channel, day), incremented atomically per send.
 */
export const channelSpend = pgTable(
  "channel_spend",
  {
    channel: text("channel").notNull(),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.channel, table.day] })],
);

/**
 * Sliding-window ledger for per-phone / per-IP / per-device send-rate
 * limits. `key` may carry a phone number or IP address — crypto-shred
 * scope; rows are prunable after their window (operational retention:
 * days, not months).
 */
export const sendRateEvents = pgTable(
  "send_rate_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope", { enum: ["phone", "ip", "device"] }).notNull(),
    key: text("key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("send_rate_events_scope_key_sent_idx").on(table.scope, table.key, table.sentAt)],
);

/**
 * Abuse alert log (velocity anomalies, budget alarms/exhaustion). `key`
 * may carry a phone number — crypto-shred scope, retention 12–24 months
 * (ADR-0011). Append-only by convention; ops dashboards read it.
 */
export const abuseAlerts = pgTable(
  "abuse_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["velocity", "budget_alarm", "budget_exhausted"] }).notNull(),
    channel: text("channel").notNull(),
    key: text("key").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("abuse_alerts_kind_created_idx").on(table.kind, table.createdAt)],
);
