import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createMockEmailChannel,
  createMockNotifyChannel,
  createMockPushChannel,
} from "@mesomed/platform";
import { eq, notificationLog, patientProfiles, user } from "@mesomed/db";
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
import { planNotification } from "../../src/modules/communication/commands/plan-notification.js";
import { createNotificationSender } from "../../src/modules/communication/sender.js";

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
