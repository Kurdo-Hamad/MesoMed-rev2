import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHONES, setupClinicHarness, type ClinicHarness } from "./clinic-fixture.js";

/**
 * Phase 9b Slice 3 (read-only provider queue): a doctor signs in on the
 * REAL mobile auth client and lists a seeded clinic day over the same
 * wire path the app uses (see clinic-fixture.ts). Proves role resolution
 * end to end: identity.me carries the doctor role (the account tab's
 * clinic-entry gate), myWorkplaces binds the owning-doctor relation, and
 * clinicDay serves server-computed allowedActions (MM-QA-003 F-07).
 */
describe("provider clinic queue via the real mobile client", () => {
  let harness: ClinicHarness;
  let bookedStartsAt = "";

  beforeAll(async () => {
    harness = await setupClinicHarness();
    // One guest booking a week out — the queue item under test.
    const booked = await harness.bookSlot();
    bookedStartsAt = booked.startsAt;
  });

  afterAll(async () => {
    await harness.close();
  });

  it("signs the doctor in and lists the clinic day with server-computed allowedActions", async () => {
    const cookie = await harness.signInCookie(PHONES.doctor);

    // Role-aware entry: identity.me carries the clinic-side role the
    // account tab gates the /clinic link on.
    const me = await harness.rpc<{ roles: string[] }>("identity.me", "query", undefined, cookie);
    expect(me.status).toBe(200);
    expect(me.data?.roles).toContain("doctor");

    // Workplace picker: the doctor's own location, bound as owning_doctor.
    const workplaces = await harness.rpc<{
      workplaces: Array<{ doctorLocationId: string; relation: string }>;
    }>("scheduling.myWorkplaces", "query", undefined, cookie);
    expect(workplaces.status).toBe(200);
    expect(workplaces.data?.workplaces).toHaveLength(1);
    expect(workplaces.data?.workplaces[0]).toMatchObject({
      doctorLocationId: harness.doctorLocationId,
      relation: "owning_doctor",
    });

    // Day queue: the booked appointment with the doctor's affordances,
    // straight from the server (no client status rules — F-07).
    const day = await harness.rpc<{
      appointments: Array<{
        startsAt: string;
        status: string;
        patientName: string | null;
        allowedActions: string[];
      }>;
    }>(
      "booking.clinicDay",
      "query",
      { doctorLocationId: harness.doctorLocationId, anchor: bookedStartsAt },
      cookie,
    );
    expect(day.status).toBe(200);
    const item = day.data?.appointments.find((a) => a.startsAt === bookedStartsAt);
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      status: "booked",
      patientName: "Queue Patient",
      allowedActions: ["confirm", "cancel"],
    });
  });

  it("denies the clinic day to an anonymous session (layer a)", async () => {
    const anonymous = await harness.rpc("booking.clinicDay", "query", {
      doctorLocationId: harness.doctorLocationId,
      anchor: bookedStartsAt,
    });
    expect(anonymous.status).toBe(401);
  });
});
