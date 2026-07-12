import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  nextGuestPhone,
  openSlotsNextWeek,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "./helpers.js";

/**
 * Phase 8 clinic-side reads: booking.clinicDay and scheduling.myWorkplaces
 * (integration per §3.12 — happy path, authz denial, binding invariant).
 * Both are dashboard queries; the layer-b location binding must mirror the
 * lifecycle commands' actor matrix exactly.
 */
describe("clinic-side dashboard reads", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let bookedStartsAt: string;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);

    const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
    bookedStartsAt = slots[0]!.startsAt;
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: bookedStartsAt,
      patient: { fullName: "Day View Patient", phone: nextGuestPhone() },
      note: "walk-in follow-up",
    });
    if (res.statusCode !== 200) throw new Error(`fixture booking failed: ${res.body}`);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  interface ClinicDayOutput {
    doctorLocationId: string;
    timeZone: string;
    date: string;
    appointments: Array<{
      appointmentId: string;
      startsAt: string;
      status: string;
      patientName: string | null;
      patientPhone: string | null;
      note: string | null;
    }>;
  }

  function clinicDay(options: { roles: string; user?: string }, anchor?: string) {
    return trpc(
      app,
      "booking.clinicDay",
      "query",
      { doctorLocationId: clinic.doctorLocationId, anchor: anchor ?? bookedStartsAt },
      options,
    );
  }

  it("returns the booked day with patient contact for the owning doctor", async () => {
    const res = await clinicDay({ roles: "doctor", user: clinic.doctorUserId });
    expect(res.statusCode).toBe(200);
    const day = result<ClinicDayOutput>(res);
    expect(day.doctorLocationId).toBe(clinic.doctorLocationId);
    expect(day.date).toBe(
      new Intl.DateTimeFormat("en-CA", { timeZone: day.timeZone }).format(new Date(bookedStartsAt)),
    );
    const booked = day.appointments.find((a) => a.startsAt === bookedStartsAt);
    expect(booked).toBeDefined();
    expect(booked!.patientName).toBe("Day View Patient");
    expect(booked!.patientPhone).toMatch(/^\+964/);
    expect(booked!.note).toBe("walk-in follow-up");
  });

  it("returns the same day to the assigned secretary and an admin", async () => {
    for (const options of [
      { roles: "secretary", user: clinic.secretaryUserId },
      { roles: "admin" },
    ]) {
      const res = await clinicDay(options);
      expect(res.statusCode).toBe(200);
      expect(result<ClinicDayOutput>(res).appointments.length).toBeGreaterThan(0);
    }
  });

  it("excludes appointments outside the anchored day", async () => {
    const dayAfter = new Date(new Date(bookedStartsAt).getTime() + 24 * 60 * 60 * 1000);
    const res = await clinicDay({ roles: "admin" }, dayAfter.toISOString());
    expect(res.statusCode).toBe(200);
    const day = result<ClinicDayOutput>(res);
    expect(day.appointments.every((a) => a.startsAt !== bookedStartsAt)).toBe(true);
  });

  it("denies a doctor who does not own the location (layer b)", async () => {
    const res = await clinicDay({ roles: "doctor", user: clinic.otherDoctorUserId });
    expect(res.statusCode).toBe(403);
  });

  it("denies a secretary not assigned to the location (layer b)", async () => {
    const res = await clinicDay({ roles: "secretary", user: clinic.otherSecretaryUserId });
    expect(res.statusCode).toBe(403);
  });

  it("denies patients and anonymous sessions (layer a)", async () => {
    const asPatient = await clinicDay({ roles: "patient", user: clinic.patientUserId });
    expect(asPatient.statusCode).toBe(403);
    const anonymous = await trpc(app, "booking.clinicDay", "query", {
      doctorLocationId: clinic.doctorLocationId,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  interface MyWorkplacesOutput {
    workplaces: Array<{ doctorLocationId: string; doctorProfileId: string; relation: string }>;
  }

  it("lists exactly the doctor's own locations as owning_doctor", async () => {
    const res = await trpc(app, "scheduling.myWorkplaces", "query", undefined, {
      roles: "doctor",
      user: clinic.doctorUserId,
    });
    expect(res.statusCode).toBe(200);
    const { workplaces } = result<MyWorkplacesOutput>(res);
    expect(workplaces.map((w) => w.doctorLocationId)).toEqual([clinic.doctorLocationId]);
    expect(workplaces[0]!.relation).toBe("owning_doctor");
    expect(workplaces[0]!.doctorProfileId).toBe(clinic.doctorProfileId);
  });

  it("lists exactly the secretary's active assignments as assigned_secretary", async () => {
    const res = await trpc(app, "scheduling.myWorkplaces", "query", undefined, {
      roles: "secretary",
      user: clinic.secretaryUserId,
    });
    expect(res.statusCode).toBe(200);
    const { workplaces } = result<MyWorkplacesOutput>(res);
    expect(workplaces.map((w) => w.doctorLocationId)).toEqual([clinic.doctorLocationId]);
    expect(workplaces[0]!.relation).toBe("assigned_secretary");
  });

  it("returns an empty list for an unassigned secretary and denies patients", async () => {
    const empty = await trpc(app, "scheduling.myWorkplaces", "query", undefined, {
      roles: "secretary",
      user: clinic.otherSecretaryUserId,
    });
    expect(empty.statusCode).toBe(200);
    expect(result<MyWorkplacesOutput>(empty).workplaces).toEqual([]);

    const asPatient = await trpc(app, "scheduling.myWorkplaces", "query", undefined, {
      roles: "patient",
      user: clinic.patientUserId,
    });
    expect(asPatient.statusCode).toBe(403);
  });
});
