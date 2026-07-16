import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, notificationLog, sendRateEvents } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { pruneNotificationLog } from "../../src/modules/communication/retention.js";
import { pruneSendRateEvents } from "../../src/kernel/abuse.js";

/**
 * Phase 10 Slice 6 (ADR-0028): the retention prune deletes exactly the
 * expired rows — old rows go (all statuses; expiry is the erasure
 * action for this data, ADR-0011), fresh rows stay.
 */
describe("data-retention prune", () => {
  let tdb: TestDatabase;
  const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    tdb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await tdb.close();
  });

  it("prunes notification_log rows past the window, keeps the rest", async () => {
    await tdb.db.insert(notificationLog).values([
      {
        template: "reminder",
        channel: "sms",
        destination: "+9647700000001",
        locale: "en",
        status: "sent",
        dedupeKey: "retention-old-sent",
        createdAt: days(541),
      },
      {
        // Even a pending row past the window is pruned — it must not
        // outlive its own retention policy.
        template: "reminder",
        channel: "sms",
        destination: "+9647700000002",
        locale: "en",
        status: "pending",
        dedupeKey: "retention-old-pending",
        createdAt: days(600),
      },
      {
        template: "reminder",
        channel: "sms",
        destination: "+9647700000003",
        locale: "en",
        status: "sent",
        dedupeKey: "retention-fresh",
        createdAt: days(10),
      },
    ]);

    const pruned = await pruneNotificationLog(tdb.db, 540);
    expect(pruned).toBe(2);

    const remaining = await tdb.db
      .select({ dedupeKey: notificationLog.dedupeKey })
      .from(notificationLog)
      .where(eq(notificationLog.template, "reminder"));
    expect(remaining.map((r) => r.dedupeKey)).toEqual(["retention-fresh"]);
  });

  it("prunes send_rate_events past the window, keeps the rest", async () => {
    await tdb.db.insert(sendRateEvents).values([
      { scope: "phone", key: "+9647700000001", sentAt: days(8) },
      { scope: "ip", key: "10.0.0.1", sentAt: days(30) },
      { scope: "phone", key: "+9647700000002", sentAt: days(1) },
    ]);

    const pruned = await pruneSendRateEvents(tdb.db, 7);
    expect(pruned).toBe(2);

    const remaining = await tdb.db.select({ key: sendRateEvents.key }).from(sendRateEvents);
    expect(remaining.map((r) => r.key)).toEqual(["+9647700000002"]);
  });
});
