import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createMockEmailChannel,
  createMockNotifyChannel,
  createMockPushChannel,
} from "@mesomed/platform";
import { and, deviceTokens, eq, notificationLog, patientProfiles, user } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  nextGuestPhone,
  openSlotsNextWeek,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";
import { waitFor } from "../helpers.js";
import { registerDeviceToken } from "../../src/modules/communication/commands/register-device-token.js";
import { setChannelPreferences } from "../../src/modules/communication/commands/channel-preferences.js";
import { planNotification } from "../../src/modules/communication/commands/plan-notification.js";
import { createNotificationSender } from "../../src/modules/communication/sender.js";
import { onPrescriptionIssued } from "../../src/modules/communication/events/on-prescription-issued.js";
import {
  onSubscriptionActivated,
  onSubscriptionExpired,
} from "../../src/modules/communication/events/on-billing-events.js";

async function bookGuest(app: FastifyInstance, clinic: ClinicFixture): Promise<string> {
  const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
  const slot = slots[0];
  if (!slot) throw new Error("No open slot available for the dispatch fixture");
  const res = await trpc(app, "booking.guestBook", "mutation", {
    doctorLocationId: clinic.doctorLocationId,
    startsAt: slot.startsAt,
    patient: { fullName: "Dispatch Test Patient", phone: nextGuestPhone() },
  });
  expect(res.statusCode).toBe(200);
  const { appointmentId } = result<{ appointmentId: string }>(res);
  return appointmentId;
}

describe("communication dispatch (MM-PLAN-001 §5 Phase 7)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  const whatsapp = createMockNotifyChannel("whatsapp");
  const sms = createMockNotifyChannel("sms");
  const push = createMockPushChannel();
  const email = createMockEmailChannel();

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("plans and delivers a WhatsApp confirmation for a guest booking (real booking.booked.v1 → subscriber → sender)", async () => {
    const clinic = await seedClinic(app);
    const appointmentId = await bookGuest(app, clinic);

    const row = await waitFor(async () => {
      const [found] = await app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.appointmentId, appointmentId));
      return found;
    });
    expect(row.template).toBe("booking_confirmation");
    expect(row.channel).toBe("whatsapp");
    expect(row.status).toBe("pending");
    expect(row.destination).not.toBeNull();

    const sender = createNotificationSender({
      db: app.kernel.db,
      config: app.kernel.config,
      log: app.log,
      channels: { whatsapp, sms, push, email },
    });
    await sender.pump();

    const [delivered] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, row.id));
    expect(delivered!.status).toBe("sent");
    expect(whatsapp.sent.some((m) => m.to === row.destination)).toBe(true);
  });

  it("prefers push over WhatsApp for an account patient with a live device token", async () => {
    const clinic = await seedClinic(app);

    const [patient] = await app.kernel.db
      .insert(patientProfiles)
      .values({
        userId: clinic.patientUserId,
        normalizedPhone: clinic.patientPhone,
        fullName: "Push Preferring Patient",
        claimedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: patientProfiles.id });
    const patientProfileId =
      patient?.id ??
      (
        await app.kernel.db
          .select({ id: patientProfiles.id })
          .from(patientProfiles)
          .where(eq(patientProfiles.userId, clinic.patientUserId))
      )[0]!.id;

    await registerDeviceToken(app.kernel.db, clinic.patientUserId, {
      token: `expo-token-${patientProfileId}`,
      platform: "ios",
    });

    await planNotification(app.kernel.db, {
      patientProfileId,
      appointmentId: null,
      template: "reminder",
      occurrenceKey: `push-preference-test:${patientProfileId}`,
      buildParams: () => ({ doctorName: "Dr. Push", dateTime: "tomorrow", locationName: "Clinic" }),
    });

    const [row] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.patientProfileId, patientProfileId));
    expect(row!.channel).toBe("push");
    expect(row!.destination).toBe(`expo-token-${patientProfileId}`);

    const sender = createNotificationSender({
      db: app.kernel.db,
      config: app.kernel.config,
      log: app.log,
      channels: { whatsapp, sms, push, email },
    });
    await sender.pump();

    const [delivered] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, row!.id));
    expect(delivered!.status).toBe("sent");
    expect(push.sent.some((m) => m.token === `expo-token-${patientProfileId}`)).toBe(true);
  });

  it("a failing email channel doesn't block push delivery, and the email row fails after maxAttempts", async () => {
    const patientUserId = `email-gate-user-${Date.now()}`;
    await app.kernel.db.insert(user).values({
      id: patientUserId,
      name: patientUserId,
      email: `${patientUserId}@test.mesomed.example`,
      emailVerified: true,
    });
    const [patient] = await app.kernel.db
      .insert(patientProfiles)
      .values({
        userId: patientUserId,
        normalizedPhone: "+9647712340099",
        fullName: "Email Gate Patient",
        email: "gate-patient@test.mesomed.example",
        claimedAt: new Date(),
      })
      .returning({ id: patientProfiles.id });
    const patientProfileId = patient!.id;

    await registerDeviceToken(app.kernel.db, patientUserId, {
      token: `expo-token-gate-${patientProfileId}`,
      platform: "android",
    });

    await planNotification(app.kernel.db, {
      patientProfileId,
      appointmentId: null,
      template: "reminder",
      occurrenceKey: `email-gate-test:${patientProfileId}`,
      buildParams: () => ({ doctorName: "Dr. Gate", dateTime: "tomorrow", locationName: "Clinic" }),
    });

    const rows = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.patientProfileId, patientProfileId));
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "push"]);
    const emailRowId = rows.find((r) => r.channel === "email")!.id;
    const pushRowId = rows.find((r) => r.channel === "push")!.id;

    email.failing = true;
    try {
      const sender = createNotificationSender({
        db: app.kernel.db,
        config: app.kernel.config,
        log: app.log,
        channels: { whatsapp, sms, push, email },
        maxAttempts: 2,
        backoffSeconds: 0,
      });

      await sender.pump();
      const [pushAfterFirst] = await app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.id, pushRowId));
      expect(pushAfterFirst!.status).toBe("sent");
      const [emailAfterFirst] = await app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.id, emailRowId));
      expect(emailAfterFirst!.status).toBe("pending");
      expect(emailAfterFirst!.attempts).toBe(1);

      await sender.pump();
      const [emailAfterSecond] = await app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.id, emailRowId));
      expect(emailAfterSecond!.status).toBe("failed");
      expect(emailAfterSecond!.attempts).toBe(2);
      expect(emailAfterSecond!.lastError).not.toBeNull();

      // The push row is untouched by the email row's retries.
      const [pushAfterSecond] = await app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.id, pushRowId));
      expect(pushAfterSecond!.status).toBe("sent");
    } finally {
      email.failing = false;
    }
  });

  it("a second reschedule of the same appointment plans a second reschedule_notice notification (ADR-0011 F-1)", async () => {
    const clinic = await seedClinic(app);
    const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
    const [slotA, slotB, slotC] = slots;
    if (!slotA || !slotB || !slotC) {
      throw new Error("Need at least 3 open slots for the reschedule-dedupe fixture");
    }

    const booked = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: slotA.startsAt,
      patient: { fullName: "Reschedule Dedupe Patient", phone: clinic.patientPhone },
    });
    expect(booked.statusCode).toBe(200);
    const { appointmentId } = result<{ appointmentId: string }>(booked);

    async function rescheduleNoticeRows() {
      return app.kernel.db
        .select()
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.appointmentId, appointmentId),
            eq(notificationLog.template, "reschedule_notice"),
          ),
        );
    }

    const firstMove = await trpc(
      app,
      "booking.reschedule",
      "mutation",
      { appointmentId, newStartsAt: slotB.startsAt },
      { roles: "patient", user: clinic.patientUserId },
    );
    expect(firstMove.statusCode).toBe(200);
    await waitFor(async () => {
      const rows = await rescheduleNoticeRows();
      return rows.length === 1 ? rows : undefined;
    });

    // The OLD dedupe key (appointmentId-only) would treat this second,
    // distinct reschedule event as a "redelivery" of the first and plan
    // nothing — the patient would keep believing the FIRST rescheduled time.
    const secondMove = await trpc(
      app,
      "booking.reschedule",
      "mutation",
      { appointmentId, newStartsAt: slotC.startsAt },
      { roles: "patient", user: clinic.patientUserId },
    );
    expect(secondMove.statusCode).toBe(200);
    const bothNotices = await waitFor(async () => {
      const rows = await rescheduleNoticeRows();
      return rows.length === 2 ? rows : undefined;
    });
    expect(new Set(bothNotices.map((r) => r.dedupeKey)).size).toBe(2);
  });

  it("a second prescription for the same patient plans a second prescription_issued notification (ADR-0011 F-1)", async () => {
    const clinic = await seedClinic(app);
    const [patient] = await app.kernel.db
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, clinic.patientUserId));
    const patientProfileId = patient!.id;

    async function issuePrescription(prescriptionId: string, eventId: string) {
      await app.kernel.db.transaction(async (tx) => {
        await onPrescriptionIssued(
          {
            name: "clinical.prescription_issued.v1",
            version: 1,
            payload: {
              prescriptionId,
              encounterId: `encounter-${prescriptionId}`,
              doctorProfileId: clinic.doctorProfileId,
              patientProfileId,
            },
          },
          tx,
          eventId,
        );
      });
    }

    async function prescriptionNoticeRows() {
      return app.kernel.db
        .select()
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.patientProfileId, patientProfileId),
            eq(notificationLog.template, "prescription_issued"),
          ),
        );
    }

    // The OLD dedupe key (patientProfileId-only, since prescription_issued
    // has no appointmentId) meant the patient's FIRST-EVER prescription
    // notice permanently blocked every later one — this is the worst F-1
    // instance: a core deliverable broken on ordinary repeat use.
    await issuePrescription("rx-first", "event-rx-first");
    expect(await prescriptionNoticeRows()).toHaveLength(1);

    await issuePrescription("rx-second", "event-rx-second");
    const bothNotices = await prescriptionNoticeRows();
    expect(bothNotices).toHaveLength(2);
    expect(new Set(bothNotices.map((r) => r.dedupeKey)).size).toBe(2);
  });

  it("each cycle of a subscription lapsing and reactivating plans its own notification (ADR-0011 F-1)", async () => {
    const clinic = await seedClinic(app);

    async function activatedRows() {
      return app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.template, "subscription_activated"));
    }
    async function expiredRows() {
      return app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.template, "subscription_expired"));
    }

    async function activate(eventId: string) {
      await app.kernel.db.transaction(async (tx) => {
        await onSubscriptionActivated(
          {
            name: "billing.subscription_activated.v1",
            version: 1,
            payload: {
              subscriptionId: "sub-under-test",
              doctorProfileId: clinic.doctorProfileId,
              paidUntil: new Date().toISOString(),
            },
          },
          tx,
          eventId,
        );
      });
    }
    async function expire(eventId: string) {
      await app.kernel.db.transaction(async (tx) => {
        await onSubscriptionExpired(
          {
            name: "billing.subscription_expired.v1",
            version: 1,
            payload: { subscriptionId: "sub-under-test", doctorProfileId: clinic.doctorProfileId },
          },
          tx,
          eventId,
        );
      });
    }

    const beforeActivated = (await activatedRows()).length;
    const beforeExpired = (await expiredRows()).length;

    // The OLD dedupe key (subscriptionId-only, stable for this doctor's
    // whole lifetime) meant only the FIRST activation and FIRST expiry ever
    // notified — a provider whose subscription lapses a second time got no
    // warning before losing public visibility.
    await activate("event-activate-1");
    await expire("event-expire-1");
    await activate("event-activate-2");
    await expire("event-expire-2");

    expect((await activatedRows()).length - beforeActivated).toBe(2);
    expect((await expiredRows()).length - beforeExpired).toBe(2);
  });

  it("honors a disabled SMS preference — a failed WhatsApp send is denied, never falls back to SMS (ADR-0011 F-4)", async () => {
    const clinic = await seedClinic(app);
    const [patient] = await app.kernel.db
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, clinic.patientUserId));
    const patientProfileId = patient!.id;

    await setChannelPreferences(app.kernel.db, clinic.patientUserId, { smsEnabled: false });

    await planNotification(app.kernel.db, {
      patientProfileId,
      appointmentId: null,
      template: "reminder",
      occurrenceKey: `sms-preference-test:${patientProfileId}`,
      buildParams: () => ({ doctorName: "Dr. Pref", dateTime: "tomorrow", locationName: "Clinic" }),
    });

    const [row] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.patientProfileId, patientProfileId),
          eq(
            notificationLog.dedupeKey,
            `reminder:sms-preference-test:${patientProfileId}:whatsapp`,
          ),
        ),
      );
    expect(row!.channel).toBe("whatsapp");

    const failingWhatsapp = createMockNotifyChannel("whatsapp");
    failingWhatsapp.failing = true;
    const smsChannel = createMockNotifyChannel("sms");
    const sender = createNotificationSender({
      db: app.kernel.db,
      config: app.kernel.config,
      log: app.log,
      channels: { whatsapp: failingWhatsapp, sms: smsChannel, push, email },
    });
    await sender.pump();

    const [afterPump] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, row!.id));
    expect(afterPump!.status).toBe("denied");
    expect(afterPump!.deniedReason).toBe("sms_disabled_by_preference");
    expect(afterPump!.channel).toBe("whatsapp"); // never rewritten to "sms"
    // Scoped to this row's own destination — pump() drains every pending row
    // in the shared test database, so other tests' unrelated rows may also
    // legitimately fall back to SMS in the same call.
    expect(smsChannel.sent.some((m) => m.to === row!.destination)).toBe(false);
  });

  it("a single malformed row doesn't block the rest of the batch (ADR-0011 F-7)", async () => {
    const goodDestination = "+9647700000321";
    const badDestination = "+9647700000322";

    await app.kernel.db.insert(notificationLog).values({
      template: "reminder",
      channel: "whatsapp",
      destination: goodDestination,
      locale: "ckb",
      paramsJson: JSON.stringify({
        doctorName: "Dr. Good",
        dateTime: "tomorrow",
        locationName: "Clinic",
      }),
      dedupeKey: `poison-row-test:good:${goodDestination}`,
    });
    const [poisonRow] = await app.kernel.db
      .insert(notificationLog)
      .values({
        template: "reminder",
        channel: "whatsapp",
        destination: badDestination,
        locale: "ckb",
        // Not valid JSON — this used to throw out of processRow entirely,
        // before any per-row try/catch caught it, abandoning every row
        // claimed alongside it in the same batch.
        paramsJson: "{not valid json",
        dedupeKey: `poison-row-test:bad:${badDestination}`,
      })
      .returning({ id: notificationLog.id });

    const whatsapp = createMockNotifyChannel("whatsapp");
    const sender = createNotificationSender({
      db: app.kernel.db,
      config: app.kernel.config,
      log: app.log,
      channels: { whatsapp, sms, push, email },
      maxAttempts: 1,
    });

    try {
      await sender.pump();

      const [goodRow] = await app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.destination, goodDestination));
      expect(goodRow!.status).toBe("sent");
      expect(whatsapp.sent.some((m) => m.to === goodDestination)).toBe(true);

      const [badRow] = await app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.id, poisonRow!.id));
      expect(badRow!.status).toBe("failed");
      expect(badRow!.attempts).toBe(1);
    } finally {
      // Leaves the table clean for the PII-scan test below, which parses
      // every row's paramsJson and would otherwise choke on this one.
      await app.kernel.db.delete(notificationLog).where(eq(notificationLog.id, poisonRow!.id));
    }
  });

  it("falls back to WhatsApp when the push token is dead, instead of retrying a gone destination (ADR-0011 F-8)", async () => {
    const clinic = await seedClinic(app);
    const [patient] = await app.kernel.db
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, clinic.patientUserId));
    const patientProfileId = patient!.id;
    const deadToken = `expo-token-dead-${patientProfileId}`;

    await registerDeviceToken(app.kernel.db, clinic.patientUserId, {
      token: deadToken,
      platform: "ios",
    });

    await planNotification(app.kernel.db, {
      patientProfileId,
      appointmentId: null,
      template: "reminder",
      occurrenceKey: `dead-push-token-test:${patientProfileId}`,
      buildParams: () => ({ doctorName: "Dr. Dead", dateTime: "tomorrow", locationName: "Clinic" }),
    });

    const [row] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.patientProfileId, patientProfileId),
          eq(notificationLog.dedupeKey, `reminder:dead-push-token-test:${patientProfileId}:push`),
        ),
      );
    expect(row!.channel).toBe("push");
    expect(row!.destination).toBe(deadToken);

    const deadPush = createMockPushChannel();
    deadPush.tokenInvalid = true;
    const fallbackWhatsapp = createMockNotifyChannel("whatsapp");
    const sender = createNotificationSender({
      db: app.kernel.db,
      config: app.kernel.config,
      log: app.log,
      channels: { whatsapp: fallbackWhatsapp, sms, push: deadPush, email },
    });
    await sender.pump();

    const [tokenRow] = await app.kernel.db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.token, deadToken));
    expect(tokenRow).toBeUndefined();

    const [afterPump] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, row!.id));
    expect(afterPump!.status).toBe("sent");
    expect(afterPump!.channel).toBe("whatsapp");
    expect(afterPump!.destination).toBe(clinic.patientPhone);
    expect(fallbackWhatsapp.sent.some((m) => m.to === clinic.patientPhone)).toBe(true);
  });

  it("cascades to SMS when the dead-push-token fallback's WhatsApp attempt also fails (ADR-0011 F-19)", async () => {
    const clinic = await seedClinic(app);
    const [patient] = await app.kernel.db
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, clinic.patientUserId));
    const patientProfileId = patient!.id;
    const deadToken = `expo-token-dead-sms-cascade-${patientProfileId}`;

    await registerDeviceToken(app.kernel.db, clinic.patientUserId, {
      token: deadToken,
      platform: "ios",
    });

    await planNotification(app.kernel.db, {
      patientProfileId,
      appointmentId: null,
      template: "reminder",
      occurrenceKey: `dead-push-sms-cascade-test:${patientProfileId}`,
      buildParams: () => ({ doctorName: "Dr. Dead", dateTime: "tomorrow", locationName: "Clinic" }),
    });

    const [row] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.patientProfileId, patientProfileId),
          eq(
            notificationLog.dedupeKey,
            `reminder:dead-push-sms-cascade-test:${patientProfileId}:push`,
          ),
        ),
      );
    expect(row!.channel).toBe("push");
    expect(row!.destination).toBe(deadToken);

    const deadPush = createMockPushChannel();
    deadPush.tokenInvalid = true;
    const failingWhatsapp = createMockNotifyChannel("whatsapp");
    failingWhatsapp.failing = true;
    const smsChannel = createMockNotifyChannel("sms");
    const sender = createNotificationSender({
      db: app.kernel.db,
      config: app.kernel.config,
      log: app.log,
      channels: { whatsapp: failingWhatsapp, sms: smsChannel, push: deadPush, email },
    });
    await sender.pump();

    const [afterPump] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, row!.id));
    expect(afterPump!.status).toBe("sent");
    expect(afterPump!.channel).toBe("sms");
    expect(afterPump!.destination).toBe(clinic.patientPhone);
    expect(smsChannel.sent.some((m) => m.to === clinic.patientPhone)).toBe(true);
  });

  it("honors a disabled SMS preference on the dead-push-token fallback — never cascades to SMS (ADR-0011 F-19)", async () => {
    const clinic = await seedClinic(app);
    const [patient] = await app.kernel.db
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, clinic.patientUserId));
    const patientProfileId = patient!.id;
    const deadToken = `expo-token-dead-sms-denied-${patientProfileId}`;

    await setChannelPreferences(app.kernel.db, clinic.patientUserId, { smsEnabled: false });
    await registerDeviceToken(app.kernel.db, clinic.patientUserId, {
      token: deadToken,
      platform: "ios",
    });

    await planNotification(app.kernel.db, {
      patientProfileId,
      appointmentId: null,
      template: "reminder",
      occurrenceKey: `dead-push-sms-denied-test:${patientProfileId}`,
      buildParams: () => ({ doctorName: "Dr. Dead", dateTime: "tomorrow", locationName: "Clinic" }),
    });

    const [row] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.patientProfileId, patientProfileId),
          eq(
            notificationLog.dedupeKey,
            `reminder:dead-push-sms-denied-test:${patientProfileId}:push`,
          ),
        ),
      );
    expect(row!.channel).toBe("push");
    expect(row!.destination).toBe(deadToken);

    const deadPush = createMockPushChannel();
    deadPush.tokenInvalid = true;
    const failingWhatsapp = createMockNotifyChannel("whatsapp");
    failingWhatsapp.failing = true;
    const smsChannel = createMockNotifyChannel("sms");
    const sender = createNotificationSender({
      db: app.kernel.db,
      config: app.kernel.config,
      log: app.log,
      channels: { whatsapp: failingWhatsapp, sms: smsChannel, push: deadPush, email },
    });
    await sender.pump();

    const [afterPump] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, row!.id));
    expect(afterPump!.status).toBe("denied");
    expect(afterPump!.deniedReason).toBe("sms_disabled_by_preference");
    // markDenied never touches `channel` — the row keeps its originally
    // planned "push", since the WhatsApp fallback never reached a point
    // (a successful send) where the row gets rewritten to reflect it.
    expect(afterPump!.channel).toBe("push");
    expect(smsChannel.sent.some((m) => m.to === clinic.patientPhone)).toBe(false);
  });

  it("retries persisting the sent status after a transient DB failure instead of resending (ADR-0011 F-11)", async () => {
    const clinic = await seedClinic(app);
    const appointmentId = await bookGuest(app, clinic);
    const row = await waitFor(async () => {
      const [found] = await app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.appointmentId, appointmentId));
      return found;
    });

    // Wraps the real db so the SPECIFIC "mark this row sent" write fails
    // twice before succeeding — everything else (claimBatch, other updates)
    // passes through unchanged. Proves markSentWithRetry retries the
    // persistence write rather than falling through to markFailedOrRetry,
    // which would resend a message the recipient already received.
    interface WhereCapable {
      where(...args: unknown[]): Promise<unknown>;
    }
    interface SetCapable {
      set(values: Record<string, unknown>): WhereCapable;
    }
    let sentWriteAttempts = 0;
    const flakyDb = new Proxy(app.kernel.db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "update") return value;
        return (...updateArgs: unknown[]) => {
          const builder = (value as (...a: unknown[]) => SetCapable).apply(target, updateArgs);
          const originalSet = builder.set.bind(builder);
          builder.set = (values: Record<string, unknown>) => {
            const setBuilder = originalSet(values);
            if (values.status !== "sent") return setBuilder;
            const originalWhere = setBuilder.where.bind(setBuilder);
            setBuilder.where = (...whereArgs: unknown[]) => {
              sentWriteAttempts++;
              if (sentWriteAttempts <= 2) {
                return Promise.reject(new Error("simulated transient db failure"));
              }
              return originalWhere(...whereArgs);
            };
            return setBuilder;
          };
          return builder;
        };
      },
    });

    const localWhatsapp = createMockNotifyChannel("whatsapp");
    const sender = createNotificationSender({
      db: flakyDb,
      config: app.kernel.config,
      log: app.log,
      channels: { whatsapp: localWhatsapp, sms, push, email },
    });
    await sender.pump();

    expect(sentWriteAttempts).toBeGreaterThanOrEqual(3);
    // The vendor was only ever asked to send once — the DB write failures
    // were retried, never treated as a reason to resend.
    expect(localWhatsapp.sent.filter((m) => m.to === row.destination)).toHaveLength(1);
    const [delivered] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, row.id));
    expect(delivered!.status).toBe("sent");
    expect(delivered!.attempts).toBe(0);
  });

  it("stop() waits for an in-flight pump to finish before resolving (ADR-0011 F-12)", async () => {
    const clinic = await seedClinic(app);
    const appointmentId = await bookGuest(app, clinic);
    const row = await waitFor(async () => {
      const [found] = await app.kernel.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.appointmentId, appointmentId));
      return found;
    });

    const slowWhatsapp = createMockNotifyChannel("whatsapp");
    const originalSend = slowWhatsapp.send.bind(slowWhatsapp);
    slowWhatsapp.send = async (message) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await originalSend(message);
    };

    const sender = createNotificationSender({
      db: app.kernel.db,
      config: app.kernel.config,
      log: app.log,
      channels: { whatsapp: slowWhatsapp, sms, push, email },
    });

    const pumpPromise = sender.pump();
    await new Promise((resolve) => setTimeout(resolve, 20)); // let pump claim the batch and start sending
    await sender.stop();
    await pumpPromise;

    const [delivered] = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, row.id));
    expect(delivered!.status).toBe("sent");
    expect(slowWhatsapp.sent.some((m) => m.to === row.destination)).toBe(true);
  });

  it("never persists the patient's name — notification_log carries linkage PII only", async () => {
    const rows = await app.kernel.db.select().from(notificationLog);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("fullName");
      if (row.paramsJson) {
        const params = JSON.parse(row.paramsJson) as Record<string, unknown>;
        expect(Object.keys(params)).not.toContain("fullName");
        expect(Object.keys(params)).not.toContain("patientName");
      }
    }
  });
});
