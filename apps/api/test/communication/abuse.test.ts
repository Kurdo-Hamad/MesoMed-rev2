import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import {
  createMockEmailChannel,
  createMockNotifyChannel,
  createMockPushChannel,
} from "@mesomed/platform";
import { abuseAlerts, eq, notificationLog, type Db } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  assertChannelEnabled,
  assertDestinationAllowed,
  assertSendRate,
  checkAndSpendBudget,
} from "../../src/kernel/abuse.js";
import { createConfigService, type ConfigService } from "../../src/kernel/config.js";
import { AppError } from "../../src/kernel/errors.js";
import { createNotificationSender } from "../../src/modules/communication/sender.js";

/**
 * Mandatory abuse-control gate items (MM-ARC-002 §6.6): each guardrail
 * must have a test proving it FIRES, plus a pass-path proving it doesn't
 * over-block legitimate traffic.
 */
describe("communication abuse guardrails", () => {
  let tdb: TestDatabase;
  let db: Db;
  let config: ConfigService;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    db = tdb.db;
    config = createConfigService(db, { ttlMs: 0 });
  }, 60_000);

  afterAll(async () => {
    await tdb.close();
  });

  describe("channel kill-switch", () => {
    it("passes when no config row exists", async () => {
      await expect(assertChannelEnabled(config, "whatsapp")).resolves.toBeUndefined();
    });

    it("fires CHANNEL_DISABLED when the channel is killed", async () => {
      await config.set(
        (await import("@mesomed/config")).channelKillSwitchSchema,
        "communication.channel_kill_switch",
        { sms: true },
      );
      await expect(assertChannelEnabled(config, "sms")).rejects.toMatchObject({
        code: "CHANNEL_DISABLED",
      });
      // Unrelated channel stays enabled.
      await expect(assertChannelEnabled(config, "whatsapp")).resolves.toBeUndefined();
    });
  });

  describe("destination-country allowlist", () => {
    it("allows an Iraq number under the launch-seed fallback", async () => {
      await expect(assertDestinationAllowed(config, "+9647701111111")).resolves.toBeUndefined();
    });

    it("fires DESTINATION_NOT_ALLOWED for a non-allowlisted country", async () => {
      await expect(assertDestinationAllowed(config, "+14155550100")).rejects.toBeInstanceOf(
        AppError,
      );
      await expect(assertDestinationAllowed(config, "+14155550100")).rejects.toMatchObject({
        code: "DESTINATION_NOT_ALLOWED",
      });
    });
  });

  describe("daily channel budget", () => {
    it("passes sends under budget and does nothing for unbudgeted channels", async () => {
      await expect(
        checkAndSpendBudget(db, config, "whatsapp", new Date()),
      ).resolves.toBeUndefined();
    });

    it("fires CHANNEL_BUDGET_EXCEEDED once the daily limit is crossed, and writes an alert", async () => {
      const { channelBudgetsSchema } = await import("@mesomed/config");
      await config.set(channelBudgetsSchema, "communication.channel_budgets", {
        push: { dailyLimit: 2, alarmAt: 1 },
      });
      const now = new Date();
      await checkAndSpendBudget(db, config, "push", now); // 1st: alarm
      await checkAndSpendBudget(db, config, "push", now); // 2nd: at limit, ok
      await expect(checkAndSpendBudget(db, config, "push", now)).rejects.toMatchObject({
        code: "CHANNEL_BUDGET_EXCEEDED",
      });

      const alerts = await db.select().from(abuseAlerts).where(eq(abuseAlerts.channel, "push"));
      expect(alerts.some((a) => a.kind === "budget_alarm")).toBe(true);
      expect(alerts.some((a) => a.kind === "budget_exhausted")).toBe(true);
    });
  });

  describe("per-scope send-rate limit", () => {
    it("fires RATE_LIMITED once maxSends is reached within the window", async () => {
      const { sendRatePolicySchema } = await import("@mesomed/config");
      await config.set(sendRatePolicySchema, "communication.send_rate_policy", {
        phone: { maxSends: 2, windowSeconds: 3600 },
      });
      const now = new Date();
      const key = "+9647700000001";
      await assertSendRate(db, config, "phone", key, now);
      await assertSendRate(db, config, "phone", key, now);
      await expect(assertSendRate(db, config, "phone", key, now)).rejects.toMatchObject({
        code: "RATE_LIMITED",
      });
      // A different key is unaffected.
      await expect(
        assertSendRate(db, config, "phone", "+9647700000002", now),
      ).resolves.toBeUndefined();
    });
  });

  describe("velocity anomaly detection", () => {
    /**
     * End-to-end (ADR-0011 F-2): drives real `notification_log` rows
     * through the real `NotificationSender.pump()` — the actual production
     * call site of `recordVelocity` — rather than seeding `send_rate_events`
     * by hand and calling `recordVelocity` directly. An earlier version of
     * this test passed while the guard was permanently inert in production
     * (see the `recordVelocity` doc comment): it manually seeded rows under
     * a scope no production code path ever wrote to, so the count it
     * asserted on was reachable only from the test itself.
     */
    it("writes an alert once real sends to one destination exceed the threshold, and never blocks delivery", async () => {
      const { velocityPolicySchema } = await import("@mesomed/config");
      await config.set(velocityPolicySchema, "communication.velocity_policy", {
        threshold: 2,
        windowSeconds: 3600,
      });

      const destination = "+9647700000199";
      const whatsapp = createMockNotifyChannel("whatsapp");
      const sender = createNotificationSender({
        db,
        config,
        log: pino({ level: "silent" }),
        channels: {
          whatsapp,
          sms: createMockNotifyChannel("sms"),
          push: createMockPushChannel(),
          email: createMockEmailChannel(),
        },
      });

      // 3 real, independently-dedup'd notifications to the SAME destination
      // — one more than the threshold of 2.
      for (let i = 0; i < 3; i++) {
        await db.insert(notificationLog).values({
          template: "reminder",
          channel: "whatsapp",
          destination,
          locale: "ckb",
          paramsJson: JSON.stringify({
            doctorName: "Dr. Test",
            dateTime: "tomorrow",
            locationName: "Clinic",
          }),
          dedupeKey: `velocity-e2e-test:${destination}:${i}`,
        });
      }

      await sender.pump();

      const sentRows = await db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.destination, destination));
      expect(sentRows.every((r) => r.status === "sent")).toBe(true);
      expect(whatsapp.sent).toHaveLength(3);

      const alerts = await db.select().from(abuseAlerts).where(eq(abuseAlerts.key, destination));
      expect(alerts.some((a) => a.kind === "velocity")).toBe(true);
    });
  });
});
