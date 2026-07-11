import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  ADMIN,
  buildBookingTestServer,
  openSlotsNextWeek,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";

/**
 * Scheduling command integration (§3.12: happy + invariant per command)
 * and slot generation through the real read path: the weekly schedule set
 * in the fixture must expand to break-free, block-aware slots.
 */
describe("scheduling commands and slot generation", () => {
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

  it("expands the weekly schedule into 30-minute slots minus the lunch break", async () => {
    const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
    // 7 days × (16 half-hour slots in 09:00-17:00 minus 2 in the 12:00-13:00
    // break) — the anchor week is fully in the future, so nothing is past.
    expect(slots.length).toBe(7 * 14);

    const hoursInBaghdad = new Set(
      slots.map((s) =>
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Baghdad",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(s.startsAt)),
      ),
    );
    expect(hoursInBaghdad.has("09:00")).toBe(true);
    expect(hoursInBaghdad.has("12:00")).toBe(false);
    expect(hoursInBaghdad.has("12:30")).toBe(false);
    expect(hoursInBaghdad.has("16:30")).toBe(true);
    expect(hoursInBaghdad.has("17:00")).toBe(false);
  });

  it("blockSlot removes the covered slots; removeBlockedSlot restores them", async () => {
    const before = await openSlotsNextWeek(app, clinic.doctorLocationId);
    const target = before[5]!;
    const blocked = await trpc(
      app,
      "scheduling.blockSlot",
      "mutation",
      {
        doctorLocationId: clinic.doctorLocationId,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
        reason: "conference",
      },
      ADMIN,
    );
    expect(blocked.statusCode).toBe(200);
    const { id } = result<{ id: string }>(blocked);

    const during = await openSlotsNextWeek(app, clinic.doctorLocationId);
    expect(during.length).toBe(before.length - 1);
    expect(during.some((s) => s.startsAt === target.startsAt)).toBe(false);

    const removed = await trpc(
      app,
      "scheduling.removeBlockedSlot",
      "mutation",
      { doctorLocationId: clinic.doctorLocationId, blockedSlotId: id },
      ADMIN,
    );
    expect(removed.statusCode).toBe(200);
    expect(result<{ removed: boolean }>(removed).removed).toBe(true);

    const after = await openSlotsNextWeek(app, clinic.doctorLocationId);
    expect(after.length).toBe(before.length);
  });

  it("setWeeklySchedule wholesale-replaces prior rows (invariant: input is the full truth)", async () => {
    const res = await trpc(
      app,
      "scheduling.setWeeklySchedule",
      "mutation",
      {
        doctorLocationId: clinic.otherDoctorLocationId,
        schedules: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "11:00", slotDurationMinutes: 30 },
        ],
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(200);

    const replace = await trpc(
      app,
      "scheduling.setWeeklySchedule",
      "mutation",
      {
        doctorLocationId: clinic.otherDoctorLocationId,
        schedules: [
          { dayOfWeek: 2, startTime: "10:00", endTime: "12:00", slotDurationMinutes: 60 },
        ],
      },
      ADMIN,
    );
    expect(replace.statusCode).toBe(200);

    const slots = await openSlotsNextWeek(app, clinic.otherDoctorLocationId);
    // Only the replacement remains: one weekday, two 60-minute slots.
    expect(slots.length).toBe(2);
    const days = new Set(
      slots.map((s) =>
        new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Baghdad", weekday: "short" }).format(
          new Date(s.startsAt),
        ),
      ),
    );
    expect(days).toEqual(new Set(["Tue"]));
  });

  it("rejects a break outside its schedule window (invariant violation)", async () => {
    const res = await trpc(
      app,
      "scheduling.setWeeklySchedule",
      "mutation",
      {
        doctorLocationId: clinic.doctorLocationId,
        schedules: [
          {
            dayOfWeek: 1,
            startTime: "09:00",
            endTime: "12:00",
            slotDurationMinutes: 30,
            breaks: [{ startTime: "13:00", endTime: "14:00" }],
          },
        ],
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.appCode).toBe("VALIDATION");
  });

  it("rejects a window too small for one slot (invariant violation)", async () => {
    const res = await trpc(
      app,
      "scheduling.setWeeklySchedule",
      "mutation",
      {
        doctorLocationId: clinic.doctorLocationId,
        schedules: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "09:15", slotDurationMinutes: 30 },
        ],
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.appCode).toBe("VALIDATION");
  });

  it("rejects an inverted blocked range (invariant violation)", async () => {
    const res = await trpc(
      app,
      "scheduling.blockSlot",
      "mutation",
      {
        doctorLocationId: clinic.doctorLocationId,
        startsAt: "2027-01-02T10:00:00.000Z",
        endsAt: "2027-01-02T09:00:00.000Z",
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.appCode).toBe("VALIDATION");
  });

  it("rejects linking an unknown doctor profile (invariant violation)", async () => {
    const res = await trpc(
      app,
      "scheduling.linkDoctorLocation",
      "mutation",
      {
        doctorProfileId: "3b8e0d9e-5c3a-4f6e-9a2b-1c4d5e6f7a8b",
        locationId: clinic.locationId,
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.appCode).toBe("NOT_FOUND");
  });

  it("doctorLocations public read returns the linked location", async () => {
    const res = await trpc(app, "scheduling.doctorLocations", "query", {
      doctorProfileId: clinic.doctorProfileId,
    });
    expect(res.statusCode).toBe(200);
    const { locations } = result<{ locations: Array<{ doctorLocationId: string }> }>(res);
    expect(locations.map((l) => l.doctorLocationId)).toContain(clinic.doctorLocationId);
  });

  it("owning doctor can set their schedule; another doctor cannot (layer b)", async () => {
    const own = await trpc(
      app,
      "scheduling.setWeeklySchedule",
      "mutation",
      {
        doctorLocationId: clinic.otherDoctorLocationId,
        schedules: [
          { dayOfWeek: 2, startTime: "10:00", endTime: "12:00", slotDurationMinutes: 60 },
        ],
      },
      { roles: "doctor", user: clinic.otherDoctorUserId },
    );
    expect(own.statusCode).toBe(200);

    const foreign = await trpc(
      app,
      "scheduling.setWeeklySchedule",
      "mutation",
      {
        doctorLocationId: clinic.otherDoctorLocationId,
        schedules: [
          { dayOfWeek: 2, startTime: "10:00", endTime: "12:00", slotDurationMinutes: 60 },
        ],
      },
      { roles: "doctor", user: clinic.doctorUserId },
    );
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.data.appCode).toBe("FORBIDDEN");
  });

  it("assigned secretary can block a slot; unassigned cannot (layer b)", async () => {
    const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
    const target = slots[slots.length - 1]!;

    const denied = await trpc(
      app,
      "scheduling.blockSlot",
      "mutation",
      {
        doctorLocationId: clinic.doctorLocationId,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
      },
      { roles: "secretary", user: clinic.otherSecretaryUserId },
    );
    expect(denied.statusCode).toBe(403);

    const allowed = await trpc(
      app,
      "scheduling.blockSlot",
      "mutation",
      {
        doctorLocationId: clinic.doctorLocationId,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
      },
      { roles: "secretary", user: clinic.secretaryUserId },
    );
    expect(allowed.statusCode).toBe(200);

    // Restore for later suites sharing this fixture instance.
    const { id } = result<{ id: string }>(allowed);
    await trpc(
      app,
      "scheduling.removeBlockedSlot",
      "mutation",
      { doctorLocationId: clinic.doctorLocationId, blockedSlotId: id },
      ADMIN,
    );
  });
});
