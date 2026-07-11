/**
 * Abuse-control guardrails (MM-PLAN-001 §5 Phase 7; MM-ARC-002 §6.6,
 * mandatory gate items). Shared by the identity OTP send path and the
 * communication sender — every phone/email/push send in the system
 * passes through these checks before the vendor call.
 *
 * Each guard is fail-closed: a missing config row does not disable the
 * guard (see the resolvers in `@mesomed/config`), and every refusal is a
 * typed AppError so callers get a distinct code, never a parsed message.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import type { NotificationChannel } from "@mesomed/contracts/communication";
import {
  resolveChannelBudget,
  resolveChannelKilled,
  resolveDestinationCountry,
  resolveSendRatePolicy,
  resolveVelocityPolicy,
  type SendRateScope,
} from "@mesomed/config";
import { abuseAlerts, and, channelSpend, eq, gt, sendRateEvents, sql, type Db } from "@mesomed/db";
import type { ConfigService } from "./config.js";
import { AppError } from "./errors.js";

/** `communication.channel_kill_switch` refuses every send on this channel. */
export async function assertChannelEnabled(
  config: ConfigService,
  channel: NotificationChannel,
): Promise<void> {
  const killed = await resolveChannelKilled(config, channel);
  if (killed) {
    throw new AppError(ErrorCode.CHANNEL_DISABLED, `Channel "${channel}" is disabled`);
  }
}

/** Fail-closed destination-country allowlist (Iraq-only at launch). */
export async function assertDestinationAllowed(config: ConfigService, phone: string): Promise<void> {
  const country = await resolveDestinationCountry(config, phone);
  if (country === null) {
    throw new AppError(ErrorCode.DESTINATION_NOT_ALLOWED, `Destination "${phone}" is not allowlisted`);
  }
}

function dayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Increments today's send counter for `channel` and enforces the
 * configured daily budget. At `alarmAt` writes a `budget_alarm` alert
 * (once — only when this send is the one that crosses the threshold); at
 * `dailyLimit` refuses the send and writes a `budget_exhausted` alert.
 * Unbudgeted channels (no config row) are not throttled.
 */
export async function checkAndSpendBudget(
  db: Db,
  config: ConfigService,
  channel: NotificationChannel,
  now: Date,
): Promise<void> {
  const budget = await resolveChannelBudget(config, channel);
  if (budget === null) return;

  const day = dayString(now);
  const [row] = await db
    .insert(channelSpend)
    .values({ channel, day, count: 1 })
    .onConflictDoUpdate({
      target: [channelSpend.channel, channelSpend.day],
      set: { count: sql`${channelSpend.count} + 1` },
    })
    .returning({ count: channelSpend.count });
  const count = row!.count;

  if (count > budget.dailyLimit) {
    await db.insert(abuseAlerts).values({
      kind: "budget_exhausted",
      channel,
      key: day,
      details: { count, dailyLimit: budget.dailyLimit },
    });
    throw new AppError(
      ErrorCode.CHANNEL_BUDGET_EXCEEDED,
      `Daily budget exceeded for channel "${channel}"`,
    );
  }
  if (count === budget.alarmAt) {
    await db.insert(abuseAlerts).values({
      kind: "budget_alarm",
      channel,
      key: day,
      details: { count, alarmAt: budget.alarmAt },
    });
  }
}

/**
 * Windowed send-rate limit per (scope, key) — e.g. per-phone, per-IP,
 * per-device. Records the attempt in the same call so the window is
 * self-maintaining; throws RATE_LIMITED once the configured max is hit.
 */
export async function assertSendRate(
  db: Db,
  config: ConfigService,
  scope: SendRateScope,
  key: string,
  now: Date,
): Promise<void> {
  const policy = await resolveSendRatePolicy(config, scope);
  const cutoff = new Date(now.getTime() - policy.windowSeconds * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sendRateEvents)
    .where(
      and(eq(sendRateEvents.scope, scope), eq(sendRateEvents.key, key), gt(sendRateEvents.sentAt, cutoff)),
    );
  const count = row!.count;
  if (count >= policy.maxSends) {
    throw new AppError(ErrorCode.RATE_LIMITED, `Send-rate limit exceeded for ${scope} "${key}"`);
  }
  await db.insert(sendRateEvents).values({ scope, key, sentAt: now });
}

/**
 * Velocity anomaly detection (MM-ARC-002 §6.6): a hook, never a gate — it
 * only ever writes an alert row when more than `threshold` sends to one
 * destination on one channel land inside the window. Callers invoke this
 * after a successful send; it never throws.
 */
export async function recordVelocity(
  db: Db,
  config: ConfigService,
  channel: NotificationChannel,
  key: string,
  now: Date,
): Promise<void> {
  const policy = await resolveVelocityPolicy(config);
  const cutoff = new Date(now.getTime() - policy.windowSeconds * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sendRateEvents)
    .where(and(eq(sendRateEvents.scope, "phone"), eq(sendRateEvents.key, key), gt(sendRateEvents.sentAt, cutoff)));
  const count = row!.count;
  if (count > policy.threshold) {
    await db.insert(abuseAlerts).values({
      kind: "velocity",
      channel,
      key,
      details: { count, threshold: policy.threshold },
    });
  }
}
