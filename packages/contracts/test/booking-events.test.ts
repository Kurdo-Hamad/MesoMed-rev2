import { describe, expect, it } from "vitest";
import { createEventRegistry } from "../src/events/index.js";
import { BOOKING_EVENTS, bookingDelayedV1, bookingRescheduledV1 } from "../src/events/booking.js";

describe("booking event contracts", () => {
  it("exposes exactly the Phase 4 + Phase 9c event set, all v1", () => {
    expect(BOOKING_EVENTS.map((event) => event.name).sort()).toEqual([
      "booking.booked.v1",
      "booking.cancelled.v1",
      "booking.completed.v1",
      "booking.confirmed.v1",
      "booking.delayed.v1",
      "booking.no_show.v1",
      "booking.rescheduled.v1",
    ]);
  });

  it("registers cleanly into an event registry", () => {
    const registry = createEventRegistry(BOOKING_EVENTS);
    expect(registry.names()).toHaveLength(BOOKING_EVENTS.length);
  });

  it("delayed carries the standard post-transition snapshot with status delayed", () => {
    const parsed = bookingDelayedV1.envelope.parse({
      name: "booking.delayed.v1",
      version: 1,
      payload: {
        appointmentId: "a1",
        doctorLocationId: "dl1",
        doctorProfileId: "d1",
        patientProfileId: "p1",
        startsAt: "2026-07-15T09:00:00.000Z",
        endsAt: "2026-07-15T09:30:00.000Z",
        status: "delayed",
        bookedVia: "guest_web",
      },
    });
    expect(parsed.payload.status).toBe("delayed");
  });

  it("the widened status enum stays runtime-additive for existing v1 payloads", () => {
    // A pre-widening payload (no "delayed" anywhere) still parses — the
    // enum widening changes no existing event's validity (MM-DES-002 §5).
    const parsed = bookingRescheduledV1.payload.parse({
      appointmentId: "a1",
      doctorLocationId: "dl1",
      doctorProfileId: "d1",
      patientProfileId: "p1",
      startsAt: "2026-07-15T09:00:00.000Z",
      endsAt: "2026-07-15T09:30:00.000Z",
      status: "confirmed",
      bookedVia: "patient_account",
      previousStartsAt: "2026-07-14T09:00:00.000Z",
      previousEndsAt: "2026-07-14T09:30:00.000Z",
    });
    expect(parsed.status).toBe("confirmed");
  });
});
