import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, appointments, domainEvents, eq, inArray } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { ACTIVE_APPOINTMENT_STATUSES } from "@mesomed/domain/booking";
import {
  buildBookingTestServer,
  nextGuestPhone,
  openSlotsNextWeek,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "./helpers.js";

/**
 * Phase 4 gate: parallel bookings for the same slot yield exactly one
 * success (§3.4 strong consistency — the partial unique index is the
 * arbiter; every loser gets typed SLOT_UNAVAILABLE and leaves no residue).
 */
describe("booking concurrency", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("N parallel guest bookings for one slot: exactly one success, N-1 typed conflicts", async () => {
    const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
    const slot = slots[0]!;
    const CONTENDERS = 8;

    const responses = await Promise.all(
      Array.from({ length: CONTENDERS }, (_, i) =>
        trpc(app, "booking.guestBook", "mutation", {
          doctorLocationId: clinic.doctorLocationId,
          startsAt: slot.startsAt,
          patient: { fullName: `Contender ${i}`, phone: nextGuestPhone() },
        }),
      ),
    );

    const winners = responses.filter((r) => r.statusCode === 200);
    const losers = responses.filter((r) => r.statusCode !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(CONTENDERS - 1);
    for (const loser of losers) {
      expect(loser.statusCode).toBe(409);
      expect(loser.json().error.data.appCode).toBe("SLOT_UNAVAILABLE");
    }

    // Exactly one slot-occupying row and one booked event committed.
    const rows = await app.kernel.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorLocationId, clinic.doctorLocationId),
          eq(appointments.startsAt, new Date(slot.startsAt)),
          inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        ),
      );
    expect(rows).toHaveLength(1);

    const events = await app.kernel.db
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(eq(domainEvents.name, "booking.booked.v1"), eq(domainEvents.aggregateId, rows[0]!.id)),
      );
    expect(events).toHaveLength(1);
  });

  it("two parallel reschedules onto one open slot: exactly one wins", async () => {
    const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
    const [a, b, target] = [slots[1]!, slots[2]!, slots[3]!];

    const book = (startsAt: string) =>
      trpc(app, "booking.guestBook", "mutation", {
        doctorLocationId: clinic.doctorLocationId,
        startsAt,
        patient: { fullName: "Mover", phone: nextGuestPhone() },
      });
    const bookedA = await book(a.startsAt);
    const bookedB = await book(b.startsAt);
    expect(bookedA.statusCode).toBe(200);
    expect(bookedB.statusCode).toBe(200);
    const idA = (bookedA.json() as { result: { data: { appointmentId: string } } }).result.data
      .appointmentId;
    const idB = (bookedB.json() as { result: { data: { appointmentId: string } } }).result.data
      .appointmentId;

    const admin = { roles: "admin", user: "race-admin" };
    const [moveA, moveB] = await Promise.all([
      trpc(
        app,
        "booking.reschedule",
        "mutation",
        { appointmentId: idA, newStartsAt: target.startsAt },
        admin,
      ),
      trpc(
        app,
        "booking.reschedule",
        "mutation",
        { appointmentId: idB, newStartsAt: target.startsAt },
        admin,
      ),
    ]);

    const outcomes = [moveA.statusCode, moveB.statusCode].sort();
    expect(outcomes).toEqual([200, 409]);
    const loser = moveA.statusCode === 200 ? moveB : moveA;
    expect(loser.json().error.data.appCode).toBe("SLOT_UNAVAILABLE");

    const atTarget = await app.kernel.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorLocationId, clinic.doctorLocationId),
          eq(appointments.startsAt, new Date(target.startsAt)),
          inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        ),
      );
    expect(atTarget).toHaveLength(1);
  });
});
