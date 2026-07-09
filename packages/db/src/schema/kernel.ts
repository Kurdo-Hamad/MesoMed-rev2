import { sql } from "drizzle-orm";
import {
  check,
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
