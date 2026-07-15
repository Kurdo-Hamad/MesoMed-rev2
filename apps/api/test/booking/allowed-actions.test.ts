import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  ADMIN,
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
 * Phase 9b Slice 2 (MM-QA-003 F-07): clinicDay items carry server-computed
 * allowedActions so clients never hard-code status rules. Asserts the exact
 * affordance set per actor at every lifecycle stage, and that an action
 * absent from allowedActions is also DENIED by the corresponding mutation —
 * affordance and authz come from the same allow-lists, proven end to end.
 */
describe("clinicDay allowedActions", () => {
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

  const asDoctor = (): CallOptions => ({ roles: "doctor", user: clinic.doctorUserId });
  const asSecretary = (): CallOptions => ({ roles: "secretary", user: clinic.secretaryUserId });

  async function guestBook(slot: { startsAt: string }) {
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: slot.startsAt,
      patient: { fullName: "Affordance Patient", phone: nextGuestPhone() },
    });
    expect(res.statusCode).toBe(200);
    return result<{ appointmentId: string }>(res).appointmentId;
  }

  async function transition(name: string, appointmentId: string, options: CallOptions) {
    const res = await trpc(app, `booking.${name}`, "mutation", { appointmentId }, options);
    expect(res.statusCode, `booking.${name} as ${options.roles}`).toBe(200);
  }

  async function actionsFor(
    appointmentId: string,
    anchor: string,
    options: CallOptions,
  ): Promise<string[]> {
    const res = await trpc(
      app,
      "booking.clinicDay",
      "query",
      { doctorLocationId: clinic.doctorLocationId, anchor },
      options,
    );
    expect(res.statusCode).toBe(200);
    const day = result<{
      appointments: Array<{ appointmentId: string; allowedActions: string[] }>;
    }>(res);
    const item = day.appointments.find((a) => a.appointmentId === appointmentId);
    expect(item, `appointment ${appointmentId} in clinicDay`).toBeDefined();
    return item!.allowedActions;
  }

  it("serves the exact per-actor affordances at every lifecycle stage", async () => {
    const slot = nextSlot();
    const appointmentId = await guestBook(slot);
    const at = slot.startsAt;

    // booked
    expect(await actionsFor(appointmentId, at, asDoctor())).toEqual(["confirm", "cancel"]);
    expect(await actionsFor(appointmentId, at, asSecretary())).toEqual(["confirm", "cancel"]);
    expect(await actionsFor(appointmentId, at, ADMIN)).toEqual(["confirm", "cancel"]);

    // confirmed — checkIn is front-desk only, so the doctor does not get
    // it; delay is clinic-side (Phase 9c)
    await transition("confirm", appointmentId, asSecretary());
    expect(await actionsFor(appointmentId, at, asDoctor())).toEqual(["noShow", "cancel", "delay"]);
    expect(await actionsFor(appointmentId, at, asSecretary())).toEqual([
      "checkIn",
      "noShow",
      "cancel",
      "delay",
    ]);
    expect(await actionsFor(appointmentId, at, ADMIN)).toEqual([
      "checkIn",
      "noShow",
      "cancel",
      "delay",
    ]);

    // checked_in — start is doctor-only; noShow and delay stay clinic-side
    await transition("checkIn", appointmentId, asSecretary());
    expect(await actionsFor(appointmentId, at, asDoctor())).toEqual(["start", "noShow", "delay"]);
    expect(await actionsFor(appointmentId, at, asSecretary())).toEqual(["noShow", "delay"]);
    expect(await actionsFor(appointmentId, at, ADMIN)).toEqual(["start", "noShow", "delay"]);

    // in_progress — complete is doctor-only; the secretary has nothing left
    await transition("start", appointmentId, asDoctor());
    expect(await actionsFor(appointmentId, at, asDoctor())).toEqual(["complete"]);
    expect(await actionsFor(appointmentId, at, asSecretary())).toEqual([]);
    expect(await actionsFor(appointmentId, at, ADMIN)).toEqual(["complete"]);

    // completed — terminal for everyone
    await transition("complete", appointmentId, asDoctor());
    for (const options of [asDoctor(), asSecretary(), ADMIN]) {
      expect(await actionsFor(appointmentId, at, options)).toEqual([]);
    }
  });

  it("terminal cancelled and no_show appointments offer no actions", async () => {
    const cancelledSlot = nextSlot();
    const cancelled = await guestBook(cancelledSlot);
    await transition("cancel", cancelled, asSecretary());
    expect(await actionsFor(cancelled, cancelledSlot.startsAt, ADMIN)).toEqual([]);

    const noShowSlot = nextSlot();
    const noShow = await guestBook(noShowSlot);
    await transition("confirm", noShow, asSecretary());
    await transition("noShow", noShow, asDoctor());
    expect(await actionsFor(noShow, noShowSlot.startsAt, ADMIN)).toEqual([]);
  });

  it("an action absent from allowedActions is also denied by the mutation (no drift)", async () => {
    const slot = nextSlot();
    const appointmentId = await guestBook(slot);
    await transition("confirm", appointmentId, asSecretary());

    // Doctor's confirmed-set excludes checkIn (front desk only)…
    expect(await actionsFor(appointmentId, slot.startsAt, asDoctor())).not.toContain("checkIn");
    // …and the checkIn mutation rejects the doctor for the same reason.
    const denied = await trpc(app, "booking.checkIn", "mutation", { appointmentId }, asDoctor());
    expect(denied.statusCode).toBe(403);

    // The secretary's set includes checkIn and the mutation honors it.
    expect(await actionsFor(appointmentId, slot.startsAt, asSecretary())).toContain("checkIn");
    await transition("checkIn", appointmentId, asSecretary());

    // Now start is offered to the doctor but not the secretary — and the
    // mutation denies the secretary.
    expect(await actionsFor(appointmentId, slot.startsAt, asSecretary())).not.toContain("start");
    const deniedStart = await trpc(
      app,
      "booking.start",
      "mutation",
      { appointmentId },
      asSecretary(),
    );
    expect(deniedStart.statusCode).toBe(403);
  });
});
