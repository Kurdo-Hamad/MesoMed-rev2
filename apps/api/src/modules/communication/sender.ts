/**
 * Notification sender (MM-PLAN-001 §5 Phase 7): polls due `pending` rows
 * (the indexed `(status, next_attempt_at)` scan), applies the same abuse
 * guardrails as OTP delivery, dispatches via the channel adapters, and
 * retries with backoff up to `maxAttempts` before marking a row `failed`.
 * A `whatsapp` row falls back to `sms` inline on failure — the same order
 * as OTP delivery (MM-DEC rev02 §8) — before counting as a failed attempt.
 * A dead push token is deleted (it would never succeed again) and the row
 * re-plans to whatever channel `resolveDeliveryPlan` picks next (typically
 * WhatsApp) — the destination is gone, not merely slow, so retrying push
 * itself has no value (ADR-0011 F-8).
 */
import type { FastifyBaseLogger } from "fastify";
import { and, deviceTokens, eq, inArray, lte, notificationLog, type Db } from "@mesomed/db";
import {
  PushTokenInvalidError,
  type EmailChannel,
  type NotifyChannel,
  type PushChannel,
} from "@mesomed/platform";
import type { Locale } from "@mesomed/contracts/i18n";
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
import { getPatientContact } from "../identity/queries/patient-contacts.js";
import { getChannelPreferences } from "./queries/channel-preferences.js";
import { resolveDeliveryPlan } from "./shared.js";
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
  /**
   * Stops the poll loop and waits for any in-flight `pump()` to finish
   * (ADR-0011 F-12) — callers (server shutdown) must not close the DB pool
   * out from under a pump that's still mid-batch.
   */
  stop(): Promise<void>;
  /** Claims and processes one due batch immediately (tests, ops tooling). */
  pump(): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_SECONDS = 60;
const PUMP_BATCH_SIZE = 50;
/**
 * Worst-case time a single row can take: each platform adapter now bounds
 * its own vendor HTTP call to 10s (ADR-0011 F-3), and a `whatsapp` row that
 * fails retries inline against `sms` before counting as a failure — so one
 * row can burn up to two full adapter timeouts serially. If either the
 * adapters' shared default timeout or this fallback shape changes, revisit
 * this constant together with it.
 */
const MAX_ROW_PROCESSING_MS = 20_000;
/**
 * How long a claimed-but-in-flight batch is protected from re-selection by
 * a concurrent pump. Sized to the batch's own worst case (every row in the
 * batch hitting `MAX_ROW_PROCESSING_MS` serially) rather than a flat
 * constant — a fixed 30s window was trivially exceeded by ordinary vendor
 * latency well before any timeout fired at all, letting a second instance
 * re-claim and double-send rows still mid-flight in the first.
 */
const CLAIM_HOLD_MS = PUMP_BATCH_SIZE * MAX_ROW_PROCESSING_MS;

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

  const MARK_SENT_RETRY_ATTEMPTS = 3;
  const MARK_SENT_RETRY_DELAY_MS = 200;

  /**
   * Persists the "sent" outcome of a delivery that has ALREADY reached the
   * vendor (ADR-0011 F-11). A transient DB failure here must never be
   * treated the same as a vendor-send failure: `markFailedOrRetry` flips the
   * row back to `pending`, and the next pump would resend a message the
   * recipient already got. So this retries the write itself a few times and,
   * if it still can't persist, logs loudly for manual reconciliation instead
   * of silently falling through to a resend path. (The row stays claimed
   * until `CLAIM_HOLD_MS` elapses, so a resend in this narrow window would
   * require the DB to fail on every retry AND recover before the claim
   * expires — accepted as documented residual risk, not fixed further, since
   * closing it completely needs a vendor-side idempotency key this system
   * doesn't have.)
   */
  async function markSentWithRetry(
    row: NotificationRow,
    fallbackChannel?: { channel: NotificationChannel; destination: string },
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MARK_SENT_RETRY_ATTEMPTS; attempt++) {
      try {
        await db
          .update(notificationLog)
          .set({
            status: "sent",
            updatedAt: new Date(),
            ...(fallbackChannel ? fallbackChannel : {}),
          })
          .where(eq(notificationLog.id, row.id));
        return;
      } catch (error) {
        lastError = error;
        if (attempt < MARK_SENT_RETRY_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, MARK_SENT_RETRY_DELAY_MS));
        }
      }
    }
    log.error(
      { err: lastError, notificationId: row.id },
      "failed to persist sent status after a successful delivery — row may be redelivered on next reclaim (ADR-0011 F-11)",
    );
  }

  /**
   * Whether the row's recipient allows SMS (ADR-0011 F-4): the WhatsApp→SMS
   * fallback below used to send SMS unconditionally on WhatsApp failure,
   * ignoring a patient who explicitly disabled `smsEnabled` — a consent
   * violation, not just a missed preference. Only patient-scoped rows ever
   * carry the `whatsapp` channel (billing's provider notices are
   * email-only), so `patientProfileId` is always present here; a guest
   * profile (no `userId` yet) has no preference row to disable, so it
   * defaults enabled, matching `resolveDeliveryPlan`'s own default.
   */
  async function isSmsFallbackAllowed(row: NotificationRow): Promise<boolean> {
    if (!row.patientProfileId) return true;
    const contact = await getPatientContact(db, row.patientProfileId);
    if (!contact?.userId) return true;
    const prefs = await getChannelPreferences(db, contact.userId);
    return prefs.smsEnabled;
  }

  async function markFailedOrRetry(row: NotificationRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const nextAttempts = row.attempts + 1;
    if (nextAttempts >= maxAttempts) {
      await db
        .update(notificationLog)
        .set({
          status: "failed",
          attempts: nextAttempts,
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(notificationLog.id, row.id));
    } else {
      const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000 * nextAttempts);
      await db
        .update(notificationLog)
        .set({
          status: "pending",
          attempts: nextAttempts,
          nextAttemptAt,
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(notificationLog.id, row.id));
    }
  }

  /**
   * A dead push token (ADR-0011 F-8) is gone, not merely slow — retrying
   * the SAME channel/destination combination is pointless. The caller
   * already deleted the dead `device_tokens` row; re-running
   * `resolveDeliveryPlan` now naturally skips push for this patient and
   * picks the next channel in its own priority order (WhatsApp, else
   * nothing). One immediate attempt is made against that channel — mirrors
   * the WhatsApp→SMS fallback's own inline-retry shape. Returns true if the
   * row reached a terminal outcome here (sent or denied); false to fall
   * through to the normal failure/retry path (no alternate channel exists,
   * or the alternate attempt also failed).
   */
  async function tryFallbackAfterDeadPushToken(
    row: NotificationRow,
    template: NotificationTemplate,
    locale: Locale,
    params: Record<string, string>,
    now: Date,
  ): Promise<boolean> {
    if (!row.patientProfileId) return false;
    const plan = await resolveDeliveryPlan(db, { patientProfileId: row.patientProfileId });
    const fallback = plan.deliveries.find((delivery) => delivery.channel !== "push");
    if (!fallback) return false;

    try {
      await assertChannelEnabled(config, fallback.channel);
      if (fallback.channel === "whatsapp" || fallback.channel === "sms") {
        await assertDestinationAllowed(config, fallback.destination);
      }
      await checkAndSpendBudget(db, config, fallback.channel, now);
    } catch (error) {
      if (error instanceof AppError) {
        await markDenied(row, error.code);
        return true;
      }
      return false;
    }

    let sentChannel: NotificationChannel = fallback.channel;

    try {
      if (fallback.channel === "whatsapp") {
        const body = renderTemplate(template, "sms", locale, params);
        try {
          await channels.whatsapp.send({ to: fallback.destination, body });
        } catch (whatsappError) {
          // Mirrors processRow's own inline WhatsApp→SMS cascade (same
          // consent check, same destination — WhatsApp's destination here
          // is already contact.normalizedPhone) so this fallback path isn't
          // asymmetric with the primary one (ADR-0011 F-19).
          log.warn({ err: whatsappError }, "whatsapp fallback failed, falling back to sms");
          if (!(await isSmsFallbackAllowed(row))) {
            await markDenied(row, "sms_disabled_by_preference");
            return true;
          }
          await assertChannelEnabled(config, "sms");
          await assertDestinationAllowed(config, fallback.destination);
          await checkAndSpendBudget(db, config, "sms", now);
          await channels.sms.send({ to: fallback.destination, body });
          sentChannel = "sms";
        }
      } else {
        const subject = renderTemplate(template, "emailSubject", locale, params);
        const body = renderTemplate(template, "emailBody", locale, params);
        await channels.email.send({ to: fallback.destination, subject, text: body });
      }
    } catch {
      return false;
    }

    // Delivery to the vendor already succeeded past this point — any failure
    // below must never surface as a thrown error back to the caller, which
    // would otherwise route through markFailedOrRetry and resend (F-11).
    recordNotificationSend(sentChannel, "sent");
    await markSentWithRetry(row, { channel: sentChannel, destination: fallback.destination });
    try {
      await recordVelocity(db, config, sentChannel, fallback.destination, now);
    } catch (error) {
      log.warn({ err: error }, "failed to record velocity after a successful fallback delivery");
    }
    return true;
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
          if (!(await isSmsFallbackAllowed(row))) {
            await markDenied(row, "sms_disabled_by_preference");
            return;
          }
          await assertChannelEnabled(config, "sms");
          await checkAndSpendBudget(db, config, "sms", now);
          await channels.sms.send({ to: destination, body });
          await db
            .update(notificationLog)
            .set({ channel: "sms" })
            .where(eq(notificationLog.id, row.id));
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
    } catch (error) {
      if (channel === "push" && error instanceof PushTokenInvalidError) {
        await db.delete(deviceTokens).where(eq(deviceTokens.token, destination));
        if (await tryFallbackAfterDeadPushToken(row, template, locale, params, now)) return;
      }
      recordNotificationSend(channel, "failed");
      await markFailedOrRetry(row, error);
      return;
    }

    // Delivery to the vendor already succeeded past this point — a failure
    // persisting that fact must never be treated as a send failure, which
    // would resend a message the recipient already received (ADR-0011 F-11).
    await markSentWithRetry(row);
    try {
      await recordVelocity(db, config, channel, destination, now);
    } catch (error) {
      log.warn({ err: error }, "failed to record velocity after a successful delivery");
    }
  }

  /** Selects due rows and immediately pushes their claim window forward, so a concurrent pump skips them. */
  async function claimBatch(): Promise<NotificationRow[]> {
    return db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.status, "pending"),
            lte(notificationLog.nextAttemptAt, new Date()),
          ),
        )
        .orderBy(notificationLog.nextAttemptAt)
        .limit(PUMP_BATCH_SIZE)
        .for("update", { skipLocked: true });
      if (due.length === 0) return [];
      await tx
        .update(notificationLog)
        .set({ nextAttemptAt: new Date(Date.now() + CLAIM_HOLD_MS) })
        .where(
          inArray(
            notificationLog.id,
            due.map((r) => r.id),
          ),
        );
      return due;
    });
  }

  /** The currently in-flight pump, if any — awaited by `stop()` (ADR-0011 F-12). */
  let inFlightPump: Promise<void> | undefined;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    inFlightPump = (async () => {
      try {
        const due = await claimBatch();
        for (const row of due) {
          try {
            await processRow(row);
          } catch (error) {
            // A single malformed/unexpected row (e.g. corrupt `paramsJson`
            // thrown by JSON.parse before any guard runs) must never abort
            // the rest of the claimed batch (ADR-0011 F-7) — without this,
            // that one row re-sorts first on every subsequent pump (it's the
            // oldest `nextAttemptAt` in the batch), throws again, and wedges
            // delivery for every other row indefinitely.
            await markFailedOrRetry(row, error);
          }
        }
      } finally {
        pumping = false;
      }
    })();
    try {
      await inFlightPump;
    } finally {
      inFlightPump = undefined;
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
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      // Server shutdown closes the DB pool right after this resolves — a
      // pump still mid-batch must finish (or at least stop touching the
      // pool) first, or it starts throwing pool-closed errors mid-delivery
      // instead of a clean stop (ADR-0011 F-12).
      await inFlightPump;
    },
    pump,
  };
}
