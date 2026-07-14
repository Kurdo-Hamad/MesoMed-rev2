import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHONES, setupClinicHarness, type ClinicHarness } from "./clinic-fixture.js";

interface TransitionResult {
  appointmentId: string;
  status: string;
}

interface DayItem {
  appointmentId: string;
  status: string;
  allowedActions: string[];
}

/**
 * Phase 9b Slice 4: every queue action flow driven over the app's real
 * wire path (real sessions, cookie-attached tRPC — see clinic-fixture.ts).
 * Each flow asserts the transition result AND that the refetched clinicDay
 * serves the next server-computed affordance set (what the screen renders
 * after invalidation, MM-QA-003 F-07). Includes a true layer-b denial: a
 * secretary whose ROLE passes layer a but who is not assigned to the
 * location is refused with the typed FORBIDDEN appCode.
 */
describe("provider queue actions via the real mobile client", () => {
  let harness: ClinicHarness;
  let secretaryCookie = "";
  let doctorCookie = "";
  let outsiderCookie = "";

  beforeAll(async () => {
    harness = await setupClinicHarness();
    secretaryCookie = await harness.signInCookie(PHONES.secretary);
    doctorCookie = await harness.signInCookie(PHONES.doctor);
    outsiderCookie = await harness.signInCookie(PHONES.outsiderSecretary);
  });

  afterAll(async () => {
    await harness.close();
  });

  function act(action: string, appointmentId: string, cookie: string) {
    return harness.rpc<TransitionResult>(
      `booking.${action}`,
      "mutation",
      { appointmentId },
      cookie,
    );
  }

  async function dayItem(
    appointmentId: string,
    startsAt: string,
    cookie: string,
  ): Promise<DayItem> {
    const day = await harness.rpc<{ appointments: DayItem[] }>(
      "booking.clinicDay",
      "query",
      { doctorLocationId: harness.doctorLocationId, anchor: startsAt },
      cookie,
    );
    expect(day.status).toBe(200);
    const item = day.data?.appointments.find((a) => a.appointmentId === appointmentId);
    expect(item, `appointment ${appointmentId} in clinicDay`).toBeDefined();
    return item!;
  }

  // One appointment walks the full happy path across the next four flows,
  // exactly as a clinic day progresses.
  let walked: { appointmentId: string; startsAt: string };

  it("secretary confirms a booked appointment", async () => {
    walked = await harness.bookSlot();
    const res = await act("confirm", walked.appointmentId, secretaryCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("confirmed");
    expect(await dayItem(walked.appointmentId, walked.startsAt, secretaryCookie)).toMatchObject({
      status: "confirmed",
      allowedActions: ["checkIn", "noShow", "cancel", "delay"],
    });
  });

  it("secretary checks in a confirmed appointment", async () => {
    const res = await act("checkIn", walked.appointmentId, secretaryCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("checked_in");
    expect(await dayItem(walked.appointmentId, walked.startsAt, secretaryCookie)).toMatchObject({
      status: "checked_in",
      allowedActions: ["noShow", "delay"],
    });
  });

  it("doctor starts a checked-in appointment", async () => {
    const res = await act("start", walked.appointmentId, doctorCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("in_progress");
    expect(await dayItem(walked.appointmentId, walked.startsAt, doctorCookie)).toMatchObject({
      status: "in_progress",
      allowedActions: ["complete"],
    });
  });

  it("doctor completes an in-progress appointment", async () => {
    const res = await act("complete", walked.appointmentId, doctorCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("completed");
    expect(await dayItem(walked.appointmentId, walked.startsAt, doctorCookie)).toMatchObject({
      status: "completed",
      allowedActions: [],
    });
  });

  it("doctor marks a confirmed appointment no-show", async () => {
    const appointment = await harness.bookSlot();
    await act("confirm", appointment.appointmentId, secretaryCookie);
    const res = await act("noShow", appointment.appointmentId, doctorCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("no_show");
    expect(
      await dayItem(appointment.appointmentId, appointment.startsAt, doctorCookie),
    ).toMatchObject({ status: "no_show", allowedActions: [] });
  });

  it("secretary cancels a booked appointment", async () => {
    const appointment = await harness.bookSlot();
    const res = await act("cancel", appointment.appointmentId, secretaryCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("cancelled");
    expect(
      await dayItem(appointment.appointmentId, appointment.startsAt, secretaryCookie),
    ).toMatchObject({ status: "cancelled", allowedActions: [] });
  });

  it("denies an unassigned secretary with the typed FORBIDDEN appCode (layer b)", async () => {
    const appointment = await harness.bookSlot();
    // Layer a passes (the outsider carries the secretary role); layer b
    // must refuse — no assignment binds them to this doctor-location.
    const denied = await act("confirm", appointment.appointmentId, outsiderCookie);
    expect(denied.status).toBe(403);
    expect(denied.appCode).toBe("FORBIDDEN");
    // The appointment is untouched: still booked, affordances intact.
    expect(
      await dayItem(appointment.appointmentId, appointment.startsAt, secretaryCookie),
    ).toMatchObject({ status: "booked", allowedActions: ["confirm", "cancel"] });
  });

  it("an action the server does not offer is also denied (affordance ⊆ authz)", async () => {
    const appointment = await harness.bookSlot();
    // booked offers no checkIn to anyone; the mutation rejects it too
    // (illegal transition), so a stale client can never skip a step.
    const item = await dayItem(appointment.appointmentId, appointment.startsAt, secretaryCookie);
    expect(item.allowedActions).not.toContain("checkIn");
    const denied = await act("checkIn", appointment.appointmentId, secretaryCookie);
    expect(denied.status).not.toBe(200);
    expect(denied.appCode).toBe("INVALID_STATUS_TRANSITION");
  });
});
