import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  openSlotsNextWeek,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "./helpers.js";

/**
 * Phase 9b cancellable slice (MM-QA-003 F-07 remediation proper): the
 * patient app's cancel affordance is the server-computed `cancellable`
 * flag on booking.myAppointments — derived from the same domain
 * transition map + actor allow-lists as clinicDay's allowedActions.
 * One appointment per lifecycle status proves the flag per status.
 * Additive output field: the frozen schema pin stays green WITHOUT
 * regeneration (its additive-tolerance meta-test is the proof mode).
 */
describe("myAppointments cancellable flag", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let slots: Array<{ startsAt: string; endsAt: string }>;
  let slotCursor = 0;

  const nextSlot = () => slots[slotCursor++]!;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);
    slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
    expect(slots.length).toBeGreaterThan(10);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  /** Books for the CLAIMED patient profile so myAppointments sees it. */
  async function book(): Promise<string> {
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: nextSlot().startsAt,
      patient: { fullName: "Claimed Patient", phone: clinic.patientPhone },
    });
    expect(res.statusCode).toBe(200);
    return result<{ appointmentId: string }>(res).appointmentId;
  }

  async function transition(name: string, appointmentId: string, roles: string, user?: string) {
    const res = await trpc(
      app,
      `booking.${name}`,
      "mutation",
      { appointmentId },
      user === undefined ? { roles } : { roles, user },
    );
    expect(res.statusCode, `booking.${name}`).toBe(200);
  }

  it("reflects the server cancel rule for every lifecycle status", async () => {
    const secretary = { roles: "secretary", user: clinic.secretaryUserId };
    const doctor = { roles: "doctor", user: clinic.doctorUserId };

    const expected = new Map<string, { status: string; cancellable: boolean }>();

    const booked = await book();
    expected.set(booked, { status: "booked", cancellable: true });

    const confirmed = await book();
    await transition("confirm", confirmed, secretary.roles, secretary.user);
    expected.set(confirmed, { status: "confirmed", cancellable: true });

    const checkedIn = await book();
    await transition("confirm", checkedIn, secretary.roles, secretary.user);
    await transition("checkIn", checkedIn, secretary.roles, secretary.user);
    expected.set(checkedIn, { status: "checked_in", cancellable: false });

    const inProgress = await book();
    await transition("confirm", inProgress, secretary.roles, secretary.user);
    await transition("checkIn", inProgress, secretary.roles, secretary.user);
    await transition("start", inProgress, doctor.roles, doctor.user);
    expected.set(inProgress, { status: "in_progress", cancellable: false });

    const completed = await book();
    await transition("confirm", completed, secretary.roles, secretary.user);
    await transition("checkIn", completed, secretary.roles, secretary.user);
    await transition("start", completed, doctor.roles, doctor.user);
    await transition("complete", completed, doctor.roles, doctor.user);
    expected.set(completed, { status: "completed", cancellable: false });

    const noShow = await book();
    await transition("confirm", noShow, secretary.roles, secretary.user);
    await transition("noShow", noShow, secretary.roles, secretary.user);
    expected.set(noShow, { status: "no_show", cancellable: false });

    const cancelled = await book();
    await transition("cancel", cancelled, secretary.roles, secretary.user);
    expected.set(cancelled, { status: "cancelled", cancellable: false });

    // Phase 9c: a delayed patient can still bail from home (MM-DES-002 §4.5).
    const delayed = await book();
    await transition("confirm", delayed, secretary.roles, secretary.user);
    await transition("delay", delayed, secretary.roles, secretary.user);
    expected.set(delayed, { status: "delayed", cancellable: true });

    const res = await trpc(app, "booking.myAppointments", "query", undefined, {
      roles: "patient",
      user: clinic.patientUserId,
    });
    expect(res.statusCode).toBe(200);
    const { appointments } = result<{
      appointments: Array<{ appointmentId: string; status: string; cancellable: boolean }>;
    }>(res);

    for (const [appointmentId, want] of expected) {
      const row = appointments.find((a) => a.appointmentId === appointmentId);
      expect(row, `appointment ${appointmentId} (${want.status})`).toBeDefined();
      expect(row, `appointment ${appointmentId}`).toMatchObject(want);
    }
  });
});
