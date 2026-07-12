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
import { user } from "./identity.js";

/**
 * Communication module tables (MM-PLAN-001 §5 Phase 7) — owned exclusively
 * by `apps/api/src/modules/communication` (§3.1).
 *
 * PII posture (ADR-0011): subscribers consume events id-only and re-read
 * PII at send time via owning modules' published queries. The ONLY PII
 * persisted here is the `notification_log.destination` linkage (phone /
 * email / device token) plus the appointment linkage — both are
 * crypto-shred scope with a 12–24 month retention policy. Patient names
 * and rendered message bodies are never stored.
 */

export const NOTIFICATION_LOG_STATUSES = ["pending", "sent", "failed", "denied"] as const;

export const NOTIFICATION_LOG_CHANNELS = ["push", "whatsapp", "sms", "email"] as const;

/**
 * The notification outbox + audit log: subscribers plan deliveries by
 * inserting `pending` rows inside the event-handler transaction
 * (exactly-once by construction); the sender loop delivers them with
 * per-row attempts/backoff. `dedupeKey` makes planning idempotent — the
 * reminder cron and event redeliveries collapse onto one row.
 */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Cross-module reference (identity), no FK — same precedent as booking. */
    patientProfileId: uuid("patient_profile_id"),
    /** Identity user id for account-holder deliveries (push/preferences). */
    userId: text("user_id"),
    /** Cross-module reference (booking) — crypto-shred scope (ADR-0011). */
    appointmentId: uuid("appointment_id"),
    template: text("template").notNull(),
    channel: text("channel", { enum: NOTIFICATION_LOG_CHANNELS }).notNull(),
    /**
     * PII: destination phone number / email address / device token —
     * crypto-shred scope, retention 12–24 months (ADR-0011).
     */
    destination: text("destination"),
    locale: text("locale").notNull(),
    /** Template params re-read at plan time (names/times) — crypto-shred scope. */
    paramsJson: text("params_json"),
    status: text("status", { enum: NOTIFICATION_LOG_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    /** Reason a guardrail denied the send (kill_switch | destination | budget). */
    deniedReason: text("denied_reason"),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_log_dedupe_key_unique").on(table.dedupeKey),
    // The sender's poll: due pending rows only.
    index("notification_log_pending_due_idx")
      .on(table.status, table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    index("notification_log_channel_created_idx").on(table.channel, table.createdAt),
    index("notification_log_patient_profile_idx").on(table.patientProfileId),
    check(
      "notification_log_status_check",
      sql`${table.status} in ('pending', 'sent', 'failed', 'denied')`,
    ),
  ],
);

/**
 * Per-user channel preferences (MM-DEC §6). Missing row = all channels
 * enabled, platform default locale — a user only gets a row after
 * explicitly setting preferences.
 */
export const userChannelPreferences = pgTable("user_channel_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(true),
  smsEnabled: boolean("sms_enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  /** Preferred notification locale; null = platform default (ckb). */
  locale: text("locale"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Registered Expo push tokens (MM-DEC §6: push becomes primary once a
 * token exists). Token values are device-scoped credentials — crypto-shred
 * scope. Invalid tokens (Expo DeviceNotRegistered) are deleted by the
 * sender.
 */
export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** PII/credential: Expo push token — crypto-shred scope (ADR-0011). */
    token: text("token").notNull(),
    platform: text("platform", { enum: ["ios", "android"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("device_tokens_token_unique").on(table.token),
    index("device_tokens_user_idx").on(table.userId),
  ],
);
