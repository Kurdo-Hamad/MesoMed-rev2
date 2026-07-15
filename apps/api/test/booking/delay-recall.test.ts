import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { appointments, domainEvents, and, eq } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  nextGuestPhone,
  openSlotsNextWeek,
  result,
  seedClinic,
  trpc,
  type CallOptions,
  type ClinicFixture,
} from "./helpers.js";

/**
 * Phase 9c Slice 2 (MM-DES-002 §9): delay/recall server vertical. Every
 * flow runs through the real HTTP surface; events are asserted against
 * the outbox rows committed in the SAME transaction as the status write
 * (§3.2). The immutability proof pins the "delay never silently moves
 * other appointments" owner constraint by construction: sibling rows are
 * byte-identical across a delay and the delayed row keeps its instants.
 */
describe("delay / recall lifecycle (Phase 9c)", () => {
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

  const secretary = (): CallOptions => ({ roles: "secretary", user: clinic.secretaryUserId });
  const doctor = (): CallOptions => ({ roles: "doctor", user: clinic.doctorUserId });
  const patient = (): CallOptions => ({ roles: "patient", user: clinic.patientUserId });
  const outsiderSecretary = (): CallOptions => ({
    roles: "secretary",
    user: clinic.otherSecretaryUserId,
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
      patient: { fullName: "Late Patient", phone },
    });
    expect(res.statusCode).toBe(200);
    return result<{ appointmentId: string }>(res).appointmentId;
  }

  async function act(
    action: string,
    appointmentId: string,
    options: CallOptions,
    expectedStatus?: string,
  ) {
    const res = await trpc(app, `booking.${action}`, "mutation", { appointmentId }, options);
    expect(res.statusCode, `booking.${action}`).toBe(200);
    if (expectedStatus !== undefined) {
      expect(result<{ status: string }>(res).status).toBe(expectedStatus);
    }
    return res;
  }

  async function statusOf(appointmentId: string): Promise<string> {
    const [row] = await app.kernel.db
      .select({ status: appointments.status })
      .from(appointments)
      .where(eq(appointments.id, appointmentId));
    return row!.status;
  }

  /** Book + confirm: the state the three-way late-patient choice happens in. */
  async function confirmedAppointment(slot = nextSlot(), phone?: string) {
    const id = await guestBook(slot, phone);
    await act("confirm", id, secretary());
    return { id, slot };
  }

  // ── Happy paths ───────────────────────────────────────────────────────

  it("secretary delays a confirmed appointment; booking.delayed.v1 commits with the write", async () => {
    const { id } = await confirmedAppointment();
    await act("delay", id, secretary(), "delayed");
    expect(await eventsFor(id)).toEqual([
      "booking.booked.v1",
      "booking.confirmed.v1",
      "booking.delayed.v1",
    ]);
  });

  it("doctor delays a checked-in patient who stepped out", async () => {
    const { id } = await confirmedAppointment();
    await act("checkIn", id, secretary());
    await act("delay", id, doctor(), "delayed");
    expect(await eventsFor(id)).toContain("booking.delayed.v1");
  });

  it("recall returns the arrived patient to checked_in and emits NOTHING (§5)", async () => {
    const { id } = await confirmedAppointment();
    await act("delay", id, secretary());
    await act("recall", id, doctor(), "checked_in");
    // No booking event exists for checked_in — recall included.
    expect(await eventsFor(id)).toEqual([
      "booking.booked.v1",
      "booking.confirmed.v1",
      "booking.delayed.v1",
    ]);
  });

  it("delay → recall → delay again: the deliberate cycle, one fresh delayed event per delay", async () => {
    const { id } = await confirmedAppointment();
    await act("delay", id, secretary(), "delayed");
    await act("recall", id, secretary(), "checked_in");
    await act("delay", id, doctor(), "delayed");
    const delayedEvents = (await eventsFor(id)).filter((n) => n === "booking.delayed.v1");
    expect(delayedEvents).toHaveLength(2);
    const rows = await app.kernel.db
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(and(eq(domainEvents.aggregateId, id), eq(domainEvents.name, "booking.delayed.v1")));
    // Distinct event ids — occurrence keys stay distinct for any future
    // subscriber (ADR-0011 F-1).
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("delayed patient never arrives → manual no_show", async () => {
    const { id } = await confirmedAppointment();
    await act("delay", id, secretary());
    await act("noShow", id, doctor(), "no_show");
    expect(await eventsFor(id)).toContain("booking.no_show.v1");
  });

  it("patient cancels their own delayed appointment from home", async () => {
    const { id } = await confirmedAppointment(nextSlot(), clinic.patientPhone);
    await act("delay", id, secretary());
    const res = await trpc(
      app,
      "booking.cancel",
      "mutation",
      { appointmentId: id, reason: "went home" },
      patient(),
    );
    expect(res.statusCode).toBe(200);
    expect(result<{ status: string }>(res).status).toBe("cancelled");
  });

  // ── Reschedule from delayed (D4 + D4a) ────────────────────────────────

  it("clinic-side reschedule-from-delayed lands confirmed at the new slot; the event never carries delayed", async () => {
    const { id } = await confirmedAppointment();
    await act("delay", id, secretary());

    const to = nextSlot();
    const res = await trpc(
      app,
      "booking.reschedule",
      "mutation",
      { appointmentId: id, newStartsAt: to.startsAt },
      secretary(),
    );
    expect(res.statusCode).toBe(200);
    const payload = result<{ status: string; startsAt: string }>(res);
    expect(payload.status).toBe("confirmed");
    expect(payload.startsAt).toBe(to.startsAt);
    expect(await statusOf(id)).toBe("confirmed");

    const [event] = await app.kernel.db
      .select({ payload: domainEvents.payload })
      .from(domainEvents)
      .where(
        and(eq(domainEvents.aggregateId, id), eq(domainEvents.name, "booking.rescheduled.v1")),
      );
    expect(event).toBeDefined();
    expect((event!.payload as { status: string }).status).toBe("confirmed");
  });

  it("patient reschedule-from-delayed is denied (D4a: clinic-side only), row untouched", async () => {
    const { id, slot } = await confirmedAppointment(nextSlot(), clinic.patientPhone);
    await act("delay", id, secretary());

    const res = await trpc(
      app,
      "booking.reschedule",
      "mutation",
      { appointmentId: id, newStartsAt: nextSlot().startsAt },
      patient(),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.appCode).toBe("FORBIDDEN");

    const [row] = await app.kernel.db
      .select({ status: appointments.status, startsAt: appointments.startsAt })
      .from(appointments)
      .where(eq(appointments.id, id));
    expect(row!.status).toBe("delayed");
    expect(row!.startsAt.toISOString()).toBe(slot.startsAt);
  });

  it("patient reschedule from booked stays allowed (D4a narrows only the delayed case)", async () => {
    const id = await guestBook(nextSlot(), clinic.patientPhone);
    const to = nextSlot();
    const res = await trpc(
      app,
      "booking.reschedule",
      "mutation",
      { appointmentId: id, newStartsAt: to.startsAt },
      patient(),
    );
    expect(res.statusCode).toBe(200);
    expect(result<{ status: string }>(res).status).toBe("booked");
  });

  // ── Layer-b denials (right role, wrong binding) ───────────────────────

  it("delay: unassigned secretary → typed FORBIDDEN, row untouched", async () => {
    const { id } = await confirmedAppointment();
    const res = await trpc(
      app,
      "booking.delay",
      "mutation",
      { appointmentId: id },
      outsiderSecretary(),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.appCode).toBe("FORBIDDEN");
    expect(await statusOf(id)).toBe("confirmed");
    expect(await eventsFor(id)).not.toContain("booking.delayed.v1");
  });

  it("recall: unassigned secretary → typed FORBIDDEN, row untouched", async () => {
    const { id } = await confirmedAppointment();
    await act("delay", id, secretary());
    const res = await trpc(
      app,
      "booking.recall",
      "mutation",
      { appointmentId: id },
      outsiderSecretary(),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.appCode).toBe("FORBIDDEN");
    expect(await statusOf(id)).toBe("delayed");
  });

  // ── Invariant violations ──────────────────────────────────────────────

  it("delay from booked / in_progress / completed → typed INVALID_STATUS_TRANSITION", async () => {
    const booked = await guestBook(nextSlot());
    const deniedBooked = await trpc(
      app,
      "booking.delay",
      "mutation",
      { appointmentId: booked },
      secretary(),
    );
    expect(deniedBooked.statusCode).toBe(409);
    expect(deniedBooked.json().error.data.appCode).toBe("INVALID_STATUS_TRANSITION");

    const { id } = await confirmedAppointment();
    await act("checkIn", id, secretary());
    await act("start", id, doctor());
    const deniedInProgress = await trpc(
      app,
      "booking.delay",
      "mutation",
      { appointmentId: id },
      doctor(),
    );
    expect(deniedInProgress.statusCode).toBe(409);
    expect(deniedInProgress.json().error.data.appCode).toBe("INVALID_STATUS_TRANSITION");

    await act("complete", id, doctor());
    const deniedCompleted = await trpc(
      app,
      "booking.delay",
      "mutation",
      { appointmentId: id },
      doctor(),
    );
    expect(deniedCompleted.statusCode).toBe(409);
    expect(deniedCompleted.json().error.data.appCode).toBe("INVALID_STATUS_TRANSITION");
  });

  it("recall from a non-delayed status → typed INVALID_STATUS_TRANSITION (target-sharing with checkIn cannot leak)", async () => {
    // confirmed → checked_in is a legal MAP transition (checkIn's edge),
    // but recall's sources are exactly [delayed] — the edge table, not the
    // target, gates the action (MM-DES-002 §2).
    const { id } = await confirmedAppointment();
    const res = await trpc(app, "booking.recall", "mutation", { appointmentId: id }, secretary());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.data.appCode).toBe("INVALID_STATUS_TRANSITION");
    expect(await statusOf(id)).toBe("confirmed");
  });

  // ── Immutability proof (owner constraint, §3/§9) ──────────────────────

  it("a delay writes exactly one row: siblings byte-identical, instants untouched", async () => {
    // Three siblings in distinct lifecycle states plus the target.
    const siblingA = await guestBook(nextSlot());
    const { id: siblingB } = await confirmedAppointment();
    const { id: siblingC } = await confirmedAppointment();
    await act("checkIn", siblingC, secretary());
    const { id: target, slot } = await confirmedAppointment();

    const snapshot = async () => {
      const rows = await app.kernel.db
        .select()
        .from(appointments)
        .where(eq(appointments.doctorLocationId, clinic.doctorLocationId));
      return new Map(rows.map((row) => [row.id, JSON.stringify(row)]));
    };

    const before = await snapshot();
    await act("delay", target, secretary(), "delayed");
    const after = await snapshot();

    expect(after.size).toBe(before.size);
    for (const [id, frozen] of before) {
      if (id === target) continue;
      expect(after.get(id), `sibling ${id} must be byte-identical`).toBe(frozen);
    }
    expect([siblingA, siblingB, siblingC].every((id) => before.has(id))).toBe(true);

    const [row] = await app.kernel.db
      .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
      .from(appointments)
      .where(eq(appointments.id, target));
    expect(row!.startsAt.toISOString()).toBe(slot.startsAt);
    expect(row!.endsAt.toISOString()).toBe(slot.endsAt);
  });

  // ── Affordance ⊆ authz for the new actions ────────────────────────────

  it("delayed rows offer exactly noShow/cancel/recall clinic-side, and an unoffered delay is rejected", async () => {
    const { id, slot } = await confirmedAppointment();
    await act("delay", id, secretary());

    const day = await trpc(
      app,
      "booking.clinicDay",
      "query",
      { doctorLocationId: clinic.doctorLocationId, anchor: slot.startsAt },
      secretary(),
    );
    expect(day.statusCode).toBe(200);
    const item = result<{
      appointments: Array<{ appointmentId: string; allowedActions: string[] }>;
    }>(day).appointments.find((a) => a.appointmentId === id);
    expect(item?.allowedActions).toEqual(["noShow", "cancel", "recall"]);

    // No delayed → delayed self-loop: the unoffered action is also denied.
    expect(item?.allowedActions).not.toContain("delay");
    const denied = await trpc(app, "booking.delay", "mutation", { appointmentId: id }, secretary());
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.data.appCode).toBe("INVALID_STATUS_TRANSITION");
  });
});
