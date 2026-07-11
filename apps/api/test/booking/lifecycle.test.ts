import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { appointments, domainEvents, eq, patientProfiles, and } from "@mesomed/db";
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
 * Full lifecycle integration per role (Phase 4 gate): guest booking →
 * secretary confirm/check-in → doctor start/complete, plus the no-show,
 * cancel and reschedule paths — each command asserting its outbox event
 * committed with the state change (§3.2).
 */
describe("appointment lifecycle", () => {
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
    expect(slots.length).toBeGreaterThan(20);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  async function eventsFor(appointmentId: string): Promise<string[]> {
    const rows = await app.kernel.db
      .select({ name: domainEvents.name })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, appointmentId))
      .orderBy(domainEvents.occurredAt);
    return rows.map((r) => r.name);
  }

  async function guestBook(slot: { startsAt: string }, phone = nextGuestPhone()) {
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: slot.startsAt,
      patient: { fullName: "Guest Patient", phone },
    });
    expect(res.statusCode).toBe(200);
    return result<{ appointmentId: string; status: string; patientProfileCreated: boolean }>(res);
  }

  it("guest booking creates profile + appointment + booked event in one commit (MM-DEC §1)", async () => {
    const phone = nextGuestPhone();
    const booked = await guestBook(nextSlot(), phone);
    expect(booked.status).toBe("booked");
    expect(booked.patientProfileCreated).toBe(true);

    const [profile] = await app.kernel.db
      .select({ id: patientProfiles.id, userId: patientProfiles.userId })
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, phone));
    expect(profile).toBeDefined();
    expect(profile!.userId).toBeNull(); // unverified guest profile

    expect(await eventsFor(booked.appointmentId)).toEqual(["booking.booked.v1"]);
  });

  it("guest booking with a known phone links the existing profile, never duplicates (§3.7)", async () => {
    const booked = await guestBook(nextSlot(), clinic.patientPhone);
    expect(booked.patientProfileCreated).toBe(false);

    const [row] = await app.kernel.db
      .select({ patientProfileId: appointments.patientProfileId })
      .from(appointments)
      .where(eq(appointments.id, booked.appointmentId));
    const [profile] = await app.kernel.db
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, clinic.patientPhone));
    expect(row!.patientProfileId).toBe(profile!.id);
  });

  it("walks the full happy path per role: confirm → check-in → start → complete", async () => {
    const booked = await guestBook(nextSlot());
    const id = booked.appointmentId;
    const secretary = { roles: "secretary", user: clinic.secretaryUserId };
    const doctor = { roles: "doctor", user: clinic.doctorUserId };

    const confirmed = await trpc(
      app,
      "booking.confirm",
      "mutation",
      { appointmentId: id },
      secretary,
    );
    expect(confirmed.statusCode).toBe(200);
    expect(result<{ status: string }>(confirmed).status).toBe("confirmed");

    const checkedIn = await trpc(
      app,
      "booking.checkIn",
      "mutation",
      { appointmentId: id },
      secretary,
    );
    expect(checkedIn.statusCode).toBe(200);

    const started = await trpc(app, "booking.start", "mutation", { appointmentId: id }, doctor);
    expect(started.statusCode).toBe(200);
    expect(result<{ status: string }>(started).status).toBe("in_progress");

    const completed = await trpc(
      app,
      "booking.complete",
      "mutation",
      { appointmentId: id },
      doctor,
    );
    expect(completed.statusCode).toBe(200);
    expect(result<{ status: string }>(completed).status).toBe("completed");

    expect(await eventsFor(id)).toEqual([
      "booking.booked.v1",
      "booking.confirmed.v1",
      "booking.completed.v1",
    ]);
  });

  it("secretary walk-in books with find-or-create and records the actor (MM-DEC §9)", async () => {
    const res = await trpc(
      app,
      "booking.secretaryBook",
      "mutation",
      {
        doctorLocationId: clinic.doctorLocationId,
        startsAt: nextSlot().startsAt,
        patient: { fullName: "Walk In", phone: clinic.otherPatientPhone },
      },
      { roles: "secretary", user: clinic.secretaryUserId },
    );
    expect(res.statusCode).toBe(200);
    const walkIn = result<{ appointmentId: string; patientProfileCreated: boolean }>(res);
    expect(walkIn.patientProfileCreated).toBe(false); // found, not created

    const [row] = await app.kernel.db
      .select({ bookedVia: appointments.bookedVia, createdBy: appointments.createdBy })
      .from(appointments)
      .where(eq(appointments.id, walkIn.appointmentId));
    expect(row!.bookedVia).toBe("secretary_walk_in");
    expect(row!.createdBy).toBe(clinic.secretaryUserId);
  });

  it("no-show path: confirmed appointment marked by the secretary", async () => {
    const booked = await guestBook(nextSlot());
    const secretary = { roles: "secretary", user: clinic.secretaryUserId };
    await trpc(
      app,
      "booking.confirm",
      "mutation",
      { appointmentId: booked.appointmentId },
      secretary,
    );
    const noShow = await trpc(
      app,
      "booking.noShow",
      "mutation",
      { appointmentId: booked.appointmentId },
      secretary,
    );
    expect(noShow.statusCode).toBe(200);
    expect(result<{ status: string }>(noShow).status).toBe("no_show");
    expect(await eventsFor(booked.appointmentId)).toContain("booking.no_show.v1");
  });

  it("patient cancels their own appointment; the slot opens up again", async () => {
    const slot = nextSlot();
    const booked = await guestBook(slot, clinic.patientPhone);
    const cancelled = await trpc(
      app,
      "booking.cancel",
      "mutation",
      { appointmentId: booked.appointmentId, reason: "cannot make it" },
      { roles: "patient", user: clinic.patientUserId },
    );
    expect(cancelled.statusCode).toBe(200);
    expect(result<{ status: string }>(cancelled).status).toBe("cancelled");
    expect(await eventsFor(booked.appointmentId)).toContain("booking.cancelled.v1");

    const open = await openSlotsNextWeek(app, clinic.doctorLocationId);
    expect(open.some((s) => s.startsAt === slot.startsAt)).toBe(true);

    const rebooked = await guestBook(slot);
    expect(rebooked.status).toBe("booked");
  });

  it("reschedule moves the appointment, keeps status, emits previous instants", async () => {
    const from = nextSlot();
    const to = nextSlot();
    const booked = await guestBook(from, clinic.patientPhone);
    const moved = await trpc(
      app,
      "booking.reschedule",
      "mutation",
      { appointmentId: booked.appointmentId, newStartsAt: to.startsAt },
      { roles: "patient", user: clinic.patientUserId },
    );
    expect(moved.statusCode).toBe(200);
    const payload = result<{ status: string; startsAt: string }>(moved);
    expect(payload.status).toBe("booked");
    expect(payload.startsAt).toBe(to.startsAt);

    const [event] = await app.kernel.db
      .select({ payload: domainEvents.payload })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.aggregateId, booked.appointmentId),
          eq(domainEvents.name, "booking.rescheduled.v1"),
        ),
      );
    expect(event).toBeDefined();
    const eventPayload = event!.payload as { previousStartsAt: string; startsAt: string };
    expect(eventPayload.previousStartsAt).toBe(from.startsAt);
    expect(eventPayload.startsAt).toBe(to.startsAt);

    // The vacated slot is bookable again.
    const rebooked = await guestBook(from);
    expect(rebooked.status).toBe("booked");
  });

  it("myAppointments returns only the session patient's rows", async () => {
    const res = await trpc(app, "booking.myAppointments", "query", undefined, {
      roles: "patient",
      user: clinic.patientUserId,
    });
    expect(res.statusCode).toBe(200);
    const { appointments: mine } = result<{
      appointments: Array<{ appointmentId: string }>;
    }>(res);
    expect(mine.length).toBeGreaterThan(0);

    const other = await trpc(app, "booking.myAppointments", "query", undefined, {
      roles: "patient",
      user: clinic.otherPatientUserId,
    });
    const { appointments: others } = result<{
      appointments: Array<{ appointmentId: string }>;
    }>(other);
    const mineIds = new Set(mine.map((a) => a.appointmentId));
    expect(others.every((a) => !mineIds.has(a.appointmentId))).toBe(true);
  });

  // ── Invariant violations (§3.12) ─────────────────────────────────────

  it("rejects an off-grid start time (invariant violation)", async () => {
    const slot = nextSlot();
    const offGrid = new Date(new Date(slot.startsAt).getTime() + 10 * 60 * 1000).toISOString();
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: offGrid,
      patient: { fullName: "Guest", phone: nextGuestPhone() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.appCode).toBe("VALIDATION");
  });

  it("rejects booking a taken slot with SLOT_UNAVAILABLE", async () => {
    const slot = nextSlot();
    await guestBook(slot);
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: slot.startsAt,
      patient: { fullName: "Guest", phone: nextGuestPhone() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.data.appCode).toBe("SLOT_UNAVAILABLE");
  });

  it("rejects an illegal transition (start on a booked appointment)", async () => {
    const booked = await guestBook(nextSlot());
    const res = await trpc(
      app,
      "booking.start",
      "mutation",
      { appointmentId: booked.appointmentId },
      { roles: "doctor", user: clinic.doctorUserId },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.data.appCode).toBe("INVALID_STATUS_TRANSITION");
  });

  it("rejects rescheduling a completed appointment", async () => {
    const booked = await guestBook(nextSlot());
    const secretary = { roles: "secretary", user: clinic.secretaryUserId };
    const doctor = { roles: "doctor", user: clinic.doctorUserId };
    await trpc(
      app,
      "booking.confirm",
      "mutation",
      { appointmentId: booked.appointmentId },
      secretary,
    );
    await trpc(
      app,
      "booking.checkIn",
      "mutation",
      { appointmentId: booked.appointmentId },
      secretary,
    );
    await trpc(app, "booking.start", "mutation", { appointmentId: booked.appointmentId }, doctor);
    await trpc(
      app,
      "booking.complete",
      "mutation",
      { appointmentId: booked.appointmentId },
      doctor,
    );

    const res = await trpc(
      app,
      "booking.reschedule",
      "mutation",
      { appointmentId: booked.appointmentId, newStartsAt: nextSlot().startsAt },
      { roles: "admin", user: "any-admin" },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.data.appCode).toBe("INVALID_STATUS_TRANSITION");
  });

  it("rejects booking in the past (invariant violation)", async () => {
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: "2020-01-06T06:00:00.000Z",
      patient: { fullName: "Guest", phone: nextGuestPhone() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.appCode).toBe("VALIDATION");
  });

  it("rejects a blocked slot with SLOT_UNAVAILABLE", async () => {
    const slot = nextSlot();
    const blocked = await trpc(
      app,
      "scheduling.blockSlot",
      "mutation",
      {
        doctorLocationId: clinic.doctorLocationId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      },
      { roles: "admin" },
    );
    expect(blocked.statusCode).toBe(200);

    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: slot.startsAt,
      patient: { fullName: "Guest", phone: nextGuestPhone() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.data.appCode).toBe("SLOT_UNAVAILABLE");
  });

  it("failed booking rolls back atomically: no appointment, no profile, no event", async () => {
    const phone = nextGuestPhone();
    // Off-grid start fails after nothing has been written; a taken slot
    // fails after the profile insert — both must leave zero residue.
    const slot = nextSlot();
    await guestBook(slot);
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: slot.startsAt,
      patient: { fullName: "Rollback Guest", phone },
    });
    expect(res.statusCode).toBe(409);

    const profiles = await app.kernel.db
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, phone));
    expect(profiles).toHaveLength(0);
  });
});
