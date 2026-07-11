/**
 * Notification sender (MM-PLAN-001 §5 Phase 7): polls due `pending` rows
 * (the indexed `(status, next_attempt_at)` scan), applies the same abuse
 * guardrails as OTP delivery, dispatches via the channel adapters, and
 * retries with backoff up to `maxAttempts` before marking a row `failed`.
 * A `whatsapp` row falls back to `sms` inline on failure — the same order
 * as OTP delivery (MM-DEC rev02 §8) — before counting as a failed attempt.
 * A dead push token is deleted so it stops being selected as a delivery
 * target; the row itself still runs its normal retry/failure path.
 */
import type { FastifyBaseLogger } from "fastify";
import {
  and,
  deviceTokens,
  eq,
  inArray,
  lte,
  notificationLog,
  type Db,
} from "@mesomed/db";
import {
  PushTokenInvalidError,
  type EmailChannel,
  type NotifyChannel,
  type PushChannel,
} from "@mesomed/platform";
import type { NotificationChannel, NotificationTemplate } from "@mesomed/contracts/communication";
import type { ConfigService } from "../../kernel/config.js";
import { AppError } from "../../kernel/errors.js";
import {
  assertChannelEnabled,
  assertDestinationAllowed,
  checkAndSpendBudget,
  recordVelocity,
} from "../../kernel/abuse.js";
import { recordNotificationSend } from "../../kernel/metrics.js";
import { renderTemplate, resolveLocale } from "./templates.js";

export interface NotificationChannels {
  whatsapp: NotifyChannel;
  sms: NotifyChannel;
  push: PushChannel;
  email: EmailChannel;
}

export interface NotificationSenderOptions {
  db: Db;
  config: ConfigService;
  log: FastifyBaseLogger;
  channels: NotificationChannels;
  pollIntervalMs?: number;
  maxAttempts?: number;
  backoffSeconds?: number;
}

export interface NotificationSender {
  /** Starts the background poll loop. A no-op if already started. */
  start(): void;
  /** Stops the background poll loop. */
  stop(): void;
  /** Claims and processes one due batch immediately (tests, ops tooling). */
  pump(): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_SECONDS = 60;
const PUMP_BATCH_SIZE = 50;
/** How long a claimed-but-in-flight row is protected from re-selection by a concurrent pump. */
const CLAIM_HOLD_MS = 30_000;

type NotificationRow = typeof notificationLog.$inferSelect;

export function createNotificationSender(options: NotificationSenderOptions): NotificationSender {
  const { db, config, log, channels } = options;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffSeconds = options.backoffSeconds ?? DEFAULT_BACKOFF_SECONDS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let timer: NodeJS.Timeout | undefined;
  let pumping = false;

  async function markDenied(row: NotificationRow, reason: string): Promise<void> {
    await db
      .update(notificationLog)
      .set({ status: "denied", deniedReason: reason, updatedAt: new Date() })
      .where(eq(notificationLog.id, row.id));
    recordNotificationSend(row.channel as NotificationChannel, "denied");
  }

  async function markSent(row: NotificationRow): Promise<void> {
    await db
      .update(notificationLog)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(notificationLog.id, row.id));
  }

  async function markFailedOrRetry(row: NotificationRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const nextAttempts = row.attempts + 1;
    if (nextAttempts >= maxAttempts) {
      await db
        .update(notificationLog)
        .set({ status: "failed", attempts: nextAttempts, lastError: message, updatedAt: new Date() })
        .where(eq(notificationLog.id, row.id));
    } else {
      const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000 * nextAttempts);
      await db
        .update(notificationLog)
        .set({ status: "pending", attempts: nextAttempts, nextAttemptAt, lastError: message, updatedAt: new Date() })
        .where(eq(notificationLog.id, row.id));
    }
  }

  async function processRow(row: NotificationRow): Promise<void> {
    const channel = row.channel as NotificationChannel;
    const template = row.template as NotificationTemplate;
    const locale = resolveLocale(row.locale);
    const params = row.paramsJson ? (JSON.parse(row.paramsJson) as Record<string, string>) : {};
    const destination = row.destination;
    if (!destination) {
      await markDenied(row, "no_destination");
      return;
    }
    const now = new Date();

    try {
      await assertChannelEnabled(config, channel);
      if (channel === "whatsapp" || channel === "sms") {
        await assertDestinationAllowed(config, destination);
      }
      await checkAndSpendBudget(db, config, channel, now);
    } catch (error) {
      if (error instanceof AppError) {
        await markDenied(row, error.code);
        return;
      }
      throw error;
    }

    try {
      if (channel === "whatsapp") {
        const body = renderTemplate(template, "sms", locale, params);
        try {
          await channels.whatsapp.send({ to: destination, body });
          recordNotificationSend("whatsapp", "sent");
        } catch (whatsappError) {
          log.warn({ err: whatsappError }, "whatsapp notification failed, falling back to sms");
          await assertChannelEnabled(config, "sms");
          await checkAndSpendBudget(db, config, "sms", now);
          await channels.sms.send({ to: destination, body });
          await db.update(notificationLog).set({ channel: "sms" }).where(eq(notificationLog.id, row.id));
          recordNotificationSend("sms", "sent");
        }
      } else if (channel === "sms") {
        const body = renderTemplate(template, "sms", locale, params);
        await channels.sms.send({ to: destination, body });
        recordNotificationSend("sms", "sent");
      } else if (channel === "push") {
        const title = renderTemplate(template, "pushTitle", locale, params);
        const body = renderTemplate(template, "pushBody", locale, params);
        await channels.push.send({ token: destination, title, body });
        recordNotificationSend("push", "sent");
      } else {
        const subject = renderTemplate(template, "emailSubject", locale, params);
        const body = renderTemplate(template, "emailBody", locale, params);
        await channels.email.send({ to: destination, subject, text: body });
        recordNotificationSend("email", "sent");
      }
      await markSent(row);
      await recordVelocity(db, config, channel, destination, now);
    } catch (error) {
      if (channel === "push" && error instanceof PushTokenInvalidError) {
        await db.delete(deviceTokens).where(eq(deviceTokens.token, destination));
      }
      recordNotificationSend(channel, "failed");
      await markFailedOrRetry(row, error);
    }
  }

  /** Selects due rows and immediately pushes their claim window forward, so a concurrent pump skips them. */
  async function claimBatch(): Promise<NotificationRow[]> {
    return db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(notificationLog)
        .where(and(eq(notificationLog.status, "pending"), lte(notificationLog.nextAttemptAt, new Date())))
        .orderBy(notificationLog.nextAttemptAt)
        .limit(PUMP_BATCH_SIZE)
        .for("update", { skipLocked: true });
      if (due.length === 0) return [];
      await tx
        .update(notificationLog)
        .set({ nextAttemptAt: new Date(Date.now() + CLAIM_HOLD_MS) })
        .where(inArray(notificationLog.id, due.map((r) => r.id)));
      return due;
    });
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      const due = await claimBatch();
      for (const row of due) await processRow(row);
    } finally {
      pumping = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        pump().catch((error) => log.error(error, "notification sender pump failed"));
      }, pollIntervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    pump,
  };
}
