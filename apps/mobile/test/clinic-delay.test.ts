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

interface MyAppointment {
  appointmentId: string;
  status: string;
  cancellable: boolean;
}

/**
 * Phase 9c Slice 3 (MM-DES-002 §9): the delay/recall flows driven over the
 * app's real wire path (real sessions, cookie-attached tRPC — see
 * clinic-fixture.ts). Each flow asserts the transition result AND the
 * refetched clinicDay affordances the screen renders after invalidation
 * (F-07: buttons come exclusively from server allowedActions). The patient
 * flow doubles as the appointments-screen verification: myAppointments
 * carries status "delayed" (the dynamic status template's input) with the
 * server-computed cancellable flag, and the patient cancels from home.
 */
describe("delay / recall via the real mobile client", () => {
  let harness: ClinicHarness;
  let secretaryCookie = "";
  let doctorCookie = "";
  let outsiderCookie = "";
  let patientCookie = "";

  beforeAll(async () => {
    harness = await setupClinicHarness();
    secretaryCookie = await harness.signInCookie(PHONES.secretary);
    doctorCookie = await harness.signInCookie(PHONES.doctor);
    outsiderCookie = await harness.signInCookie(PHONES.outsiderSecretary);
    patientCookie = await harness.signInCookie(PHONES.patient);
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

  /** Book + confirm: the state the three-way late-patient choice happens in. */
  async function confirmedAppointment(phone?: string) {
    const booked = await harness.bookSlot(phone);
    const res = await act("confirm", booked.appointmentId, secretaryCookie);
    expect(res.status).toBe(200);
    return booked;
  }

  it("secretary delays a confirmed appointment; the row offers recall, not delay", async () => {
    const { appointmentId, startsAt } = await confirmedAppointment();
    const res = await act("delay", appointmentId, secretaryCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("delayed");
    expect(await dayItem(appointmentId, startsAt, secretaryCookie)).toMatchObject({
      status: "delayed",
      allowedActions: ["noShow", "cancel", "recall"],
    });
  });

  it("doctor delays a checked-in patient who stepped out", async () => {
    const { appointmentId, startsAt } = await confirmedAppointment();
    await act("checkIn", appointmentId, secretaryCookie);
    const res = await act("delay", appointmentId, doctorCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("delayed");
    expect(await dayItem(appointmentId, startsAt, doctorCookie)).toMatchObject({
      status: "delayed",
      allowedActions: ["noShow", "cancel", "recall"],
    });
  });

  it("doctor recalls the arrived patient back to checked_in", async () => {
    const { appointmentId, startsAt } = await confirmedAppointment();
    await act("delay", appointmentId, secretaryCookie);
    const res = await act("recall", appointmentId, doctorCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("checked_in");
    expect(await dayItem(appointmentId, startsAt, doctorCookie)).toMatchObject({
      status: "checked_in",
      allowedActions: ["start", "noShow", "delay"],
    });
  });

  it("delay → recall → delay again: the deliberate cycle over the wire", async () => {
    const { appointmentId } = await confirmedAppointment();
    const first = await act("delay", appointmentId, secretaryCookie);
    expect(first.data?.status).toBe("delayed");
    const recalled = await act("recall", appointmentId, secretaryCookie);
    expect(recalled.data?.status).toBe("checked_in");
    const again = await act("delay", appointmentId, doctorCookie);
    expect(again.status).toBe(200);
    expect(again.data?.status).toBe("delayed");
  });

  it("delayed patient never arrives → manual no_show, terminal row offers nothing", async () => {
    const { appointmentId, startsAt } = await confirmedAppointment();
    await act("delay", appointmentId, secretaryCookie);
    const res = await act("noShow", appointmentId, doctorCookie);
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("no_show");
    expect(await dayItem(appointmentId, startsAt, doctorCookie)).toMatchObject({
      status: "no_show",
      allowedActions: [],
    });
  });

  it("a delayed appointment reaches the patient screen, and the patient cancels from home", async () => {
    const { appointmentId } = await confirmedAppointment(PHONES.patient);
    await act("delay", appointmentId, secretaryCookie);

    // What the appointments screen renders: the dynamic status template's
    // input is "delayed" (status_delayed key pinned by the F-10 guardrail)
    // and cancel is offered via the server-computed flag, no client rules.
    const mine = await harness.rpc<{ appointments: MyAppointment[] }>(
      "booking.myAppointments",
      "query",
      undefined,
      patientCookie,
    );
    expect(mine.status).toBe(200);
    const delayed = mine.data?.appointments.find((a) => a.appointmentId === appointmentId);
    expect(delayed).toMatchObject({ status: "delayed", cancellable: true });

    const cancelled = await act("cancel", appointmentId, patientCookie);
    expect(cancelled.status).toBe(200);
    expect(cancelled.data?.status).toBe("cancelled");
  });

  it("denies delay to an unassigned secretary with the typed FORBIDDEN appCode (layer b)", async () => {
    const { appointmentId, startsAt } = await confirmedAppointment();
    const denied = await act("delay", appointmentId, outsiderCookie);
    expect(denied.status).toBe(403);
    expect(denied.appCode).toBe("FORBIDDEN");
    // The appointment is untouched: still confirmed, affordances intact.
    expect(await dayItem(appointmentId, startsAt, secretaryCookie)).toMatchObject({
      status: "confirmed",
      allowedActions: ["checkIn", "noShow", "cancel", "delay"],
    });
  });
});
