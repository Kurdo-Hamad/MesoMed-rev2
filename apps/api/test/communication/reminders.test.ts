import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { appointments, eq, notificationLog, patientProfiles } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildBookingTestServer, seedClinic } from "../booking/helpers.js";
import { baghdadTomorrowWindowUtc, planNextDayReminders } from "../../src/modules/communication/reminders.js";

describe("next-day appointment reminders (MM-PLAN-001 §5 Phase 7)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("plans exactly one reminder per remindable appointment and is idempotent across repeated runs", async () => {
    const clinic = await seedClinic(app);
    const now = new Date();
    const { fromUtc } = baghdadTomorrowWindowUtc(now);
    const startsAt = new Date(fromUtc.getTime() + 60 * 60 * 1000); // an hour into tomorrow's window
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

    const [patient] = await app.kernel.db
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, clinic.patientUserId));

    const [appointment] = await app.kernel.db
      .insert(appointments)
      .values({
        doctorLocationId: clinic.doctorLocationId,
        patientProfileId: patient!.id,
        startsAt,
        endsAt,
        status: "booked",
        bookedVia: "patient_account",
      })
      .returning({ id: appointments.id });

    const plannedFirst = await planNextDayReminders(app.kernel.db, now);
    expect(plannedFirst).toBeGreaterThanOrEqual(1);

    const rowsAfterFirst = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.appointmentId, appointment!.id));
    expect(rowsAfterFirst).toHaveLength(1);
    expect(rowsAfterFirst[0]!.template).toBe("reminder");

    // A second run for the same day must not duplicate the row (dedupeKey).
    await planNextDayReminders(app.kernel.db, now);
    const rowsAfterSecond = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.appointmentId, appointment!.id));
    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond[0]!.id).toBe(rowsAfterFirst[0]!.id);
  });

  it("does not plan a reminder for a cancelled appointment", async () => {
    const clinic = await seedClinic(app);
    const now = new Date();
    const { fromUtc } = baghdadTomorrowWindowUtc(now);
    const startsAt = new Date(fromUtc.getTime() + 2 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

    const [patient] = await app.kernel.db
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, clinic.patientUserId));

    const [appointment] = await app.kernel.db
      .insert(appointments)
      .values({
        doctorLocationId: clinic.otherDoctorLocationId,
        patientProfileId: patient!.id,
        startsAt,
        endsAt,
        status: "cancelled",
        bookedVia: "patient_account",
      })
      .returning({ id: appointments.id });

    await planNextDayReminders(app.kernel.db, now);
    const rows = await app.kernel.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.appointmentId, appointment!.id));
    expect(rows).toHaveLength(0);
  });
});
