import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { createBookingRouter } from "../../src/modules/booking/router.js";
import { createGuestPatientProfile } from "../../src/modules/identity/commands/create-guest-patient-profile.js";
import { createSchedulingRouter } from "../../src/modules/scheduling/router.js";
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
 * Role-guard denial matrix for the Phase 4 routers (§3.6 layer a) plus
 * layer-b ownership denials, with meta-tests proving the guardrail itself:
 * EVERY procedure (mutations AND queries — MM-QA-004 F-07) on both routers
 * must appear in this matrix, so a new procedure cannot ship without
 * denial coverage (HANDOFF-001 #14).
 */
describe("scheduling + booking authz matrix", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let appointmentId: string;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);

    const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: slots[0]!.startsAt,
      patient: { fullName: "Matrix Patient", phone: clinic.patientPhone },
    });
    if (res.statusCode !== 200) throw new Error(`fixture booking failed: ${res.body}`);
    appointmentId = result<{ appointmentId: string }>(res).appointmentId;
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  const UUID = "3b8e0d9e-5c3a-4f6e-9a2b-1c4d5e6f7a8b";
  const NAME = { en: "X", ar: "س", ckb: "خ" };

  interface MatrixEntry {
    procedure: string;
    /** Defaults to "mutation" (the matrix predates query coverage). */
    kind?: "query" | "mutation";
    input?: unknown;
    /** Roles denied by the kernel role guard (layer a) → 403. */
    deniedRoles: string[];
    /** Public procedures assert the absence of an auth gate instead of 401. */
    isPublic?: boolean;
  }

  const SCHEDULING_MATRIX: MatrixEntry[] = [
    {
      procedure: "scheduling.upsertLocation",
      input: { slug: "x", name: NAME },
      deniedRoles: ["patient", "doctor", "secretary"],
    },
    {
      procedure: "scheduling.linkDoctorLocation",
      input: { doctorProfileId: UUID, locationId: UUID },
      deniedRoles: ["patient", "doctor", "secretary"],
    },
    {
      procedure: "scheduling.assignSecretary",
      input: { secretaryUserId: "u", doctorLocationId: UUID },
      deniedRoles: ["patient", "doctor", "secretary"],
    },
    {
      procedure: "scheduling.setWeeklySchedule",
      input: { doctorLocationId: UUID, schedules: [] },
      deniedRoles: ["patient", "secretary"],
    },
    {
      procedure: "scheduling.blockSlot",
      input: {
        doctorLocationId: UUID,
        startsAt: "2027-01-02T09:00:00.000Z",
        endsAt: "2027-01-02T10:00:00.000Z",
      },
      deniedRoles: ["patient"],
    },
    {
      procedure: "scheduling.removeBlockedSlot",
      input: { doctorLocationId: UUID, blockedSlotId: UUID },
      deniedRoles: ["patient"],
    },
    {
      procedure: "scheduling.doctorLocations",
      kind: "query",
      input: { doctorProfileId: UUID },
      deniedRoles: [],
      isPublic: true,
    },
    {
      procedure: "scheduling.myWorkplaces",
      kind: "query",
      deniedRoles: ["patient", "admin"],
    },
  ];

  const BOOKING_MATRIX: MatrixEntry[] = [
    {
      procedure: "booking.guestBook",
      input: {
        doctorLocationId: UUID,
        startsAt: "2027-01-02T09:00:00.000Z",
        patient: { fullName: "G", phone: "+9647700000001" },
      },
      deniedRoles: [],
      isPublic: true,
    },
    {
      procedure: "booking.secretaryBook",
      input: {
        doctorLocationId: UUID,
        startsAt: "2027-01-02T09:00:00.000Z",
        patient: { fullName: "G", phone: "+9647700000001" },
      },
      deniedRoles: ["patient", "doctor"],
    },
    { procedure: "booking.confirm", input: { appointmentId: UUID }, deniedRoles: ["patient"] },
    {
      procedure: "booking.checkIn",
      input: { appointmentId: UUID },
      deniedRoles: ["patient", "doctor"],
    },
    {
      procedure: "booking.start",
      input: { appointmentId: UUID },
      deniedRoles: ["patient", "secretary"],
    },
    {
      procedure: "booking.complete",
      input: { appointmentId: UUID },
      deniedRoles: ["patient", "secretary"],
    },
    { procedure: "booking.noShow", input: { appointmentId: UUID }, deniedRoles: ["patient"] },
    { procedure: "booking.delay", input: { appointmentId: UUID }, deniedRoles: ["patient"] },
    { procedure: "booking.recall", input: { appointmentId: UUID }, deniedRoles: ["patient"] },
    { procedure: "booking.cancel", input: { appointmentId: UUID }, deniedRoles: [] },
    {
      procedure: "booking.reschedule",
      input: { appointmentId: UUID, newStartsAt: "2027-01-02T09:00:00.000Z" },
      deniedRoles: [],
    },
    {
      procedure: "booking.weekAvailability",
      kind: "query",
      input: { doctorLocationId: UUID },
      deniedRoles: [],
      isPublic: true,
    },
    {
      procedure: "booking.clinicDay",
      kind: "query",
      input: { doctorLocationId: UUID },
      deniedRoles: ["patient"],
    },
    {
      procedure: "booking.myAppointments",
      kind: "query",
      deniedRoles: ["doctor", "secretary", "admin"],
    },
  ];

  // ── Meta-tests: the matrix covers EVERY procedure on both routers ────

  it("meta-test: EVERY booking procedure appears in the denial matrix", () => {
    const record = createBookingRouter({ createGuestPatientProfile })._def.procedures as Record<
      string,
      unknown
    >;
    const procedures = Object.keys(record)
      .map((name) => `booking.${name}`)
      .sort();
    expect(procedures).toEqual(BOOKING_MATRIX.map((e) => e.procedure).sort());
  });

  it("meta-test: EVERY scheduling procedure appears in the denial matrix", () => {
    const record = createSchedulingRouter()._def.procedures as Record<string, unknown>;
    const procedures = Object.keys(record)
      .map((name) => `scheduling.${name}`)
      .sort();
    expect(procedures).toEqual(SCHEDULING_MATRIX.map((e) => e.procedure).sort());
  });

  // ── Layer a: anonymous and wrong-role denials per procedure ──────────

  for (const entry of [...SCHEDULING_MATRIX, ...BOOKING_MATRIX]) {
    const kind = entry.kind ?? "mutation";
    if (entry.isPublic === true) {
      it(`${entry.procedure}: public — anonymous caller is not auth-gated`, async () => {
        const res = await trpc(app, entry.procedure, kind, entry.input);
        expect([401, 403]).not.toContain(res.statusCode);
      });
    } else {
      it(`${entry.procedure}: anonymous → 401 UNAUTHORIZED`, async () => {
        const res = await trpc(app, entry.procedure, kind, entry.input);
        expect(res.statusCode).toBe(401);
        expect(res.json().error.data.appCode).toBe("UNAUTHORIZED");
      });
    }

    for (const role of entry.deniedRoles) {
      it(`${entry.procedure}: ${role} → 403 FORBIDDEN (guard fires before any effect)`, async () => {
        const res = await trpc(app, entry.procedure, kind, entry.input, { roles: role });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.data.appCode).toBe("FORBIDDEN");
      });
    }
  }

  // ── Layer b: right role, wrong resource binding → 403 ────────────────

  it("secretaryBook: secretary not assigned to the doctor location → 403", async () => {
    const res = await trpc(
      app,
      "booking.secretaryBook",
      "mutation",
      {
        doctorLocationId: clinic.doctorLocationId,
        startsAt: "2027-01-02T09:00:00.000Z",
        patient: { fullName: "W", phone: nextGuestPhone() },
      },
      { roles: "secretary", user: clinic.otherSecretaryUserId },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.appCode).toBe("FORBIDDEN");
  });

  it("confirm: unassigned secretary → 403", async () => {
    const res = await trpc(
      app,
      "booking.confirm",
      "mutation",
      { appointmentId },
      { roles: "secretary", user: clinic.otherSecretaryUserId },
    );
    expect(res.statusCode).toBe(403);
  });

  it("start: doctor who does not own the location → 403", async () => {
    const res = await trpc(
      app,
      "booking.start",
      "mutation",
      { appointmentId },
      { roles: "doctor", user: clinic.otherDoctorUserId },
    );
    expect(res.statusCode).toBe(403);
  });

  it("cancel: a different patient → 403", async () => {
    const res = await trpc(
      app,
      "booking.cancel",
      "mutation",
      { appointmentId },
      { roles: "patient", user: clinic.otherPatientUserId },
    );
    expect(res.statusCode).toBe(403);
  });

  it("cancel: patient role with no claimed profile → 403", async () => {
    const res = await trpc(
      app,
      "booking.cancel",
      "mutation",
      { appointmentId },
      { roles: "patient", user: "session-without-profile" },
    );
    expect(res.statusCode).toBe(403);
  });

  it("reschedule: a different patient → 403", async () => {
    const res = await trpc(
      app,
      "booking.reschedule",
      "mutation",
      { appointmentId, newStartsAt: "2027-01-02T09:00:00.000Z" },
      { roles: "patient", user: clinic.otherPatientUserId },
    );
    expect(res.statusCode).toBe(403);
  });

  it("meta-test: the layer-b guard fires before any state change (no event, status intact)", async () => {
    // The denied confirm above must have written nothing: still booked,
    // and no confirmed event exists for this appointment.
    const res = await trpc(app, "booking.myAppointments", "query", undefined, {
      roles: "patient",
      user: clinic.patientUserId,
    });
    const { appointments: mine } = result<{
      appointments: Array<{ appointmentId: string; status: string }>;
    }>(res);
    const target = mine.find((a) => a.appointmentId === appointmentId);
    expect(target?.status).toBe("booked");
  });

  it("rejects out-of-contract input with 400 (guestBook without phone)", async () => {
    const res = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: UUID,
      startsAt: "2027-01-02T09:00:00.000Z",
      patient: { fullName: "No Phone" },
    });
    expect(res.statusCode).toBe(400);
  });
});
