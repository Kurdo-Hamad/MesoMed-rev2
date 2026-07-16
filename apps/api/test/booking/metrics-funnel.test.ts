// This import MUST stay first: it registers the global MeterProvider
// before the app modules (imported via helpers.js) create their meters.
import { metricExporter as exporter, metricProvider as provider } from "./metrics-setup.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { metrics } from "@opentelemetry/api";
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
 * Booking-funnel counters (ADR-0026): guestBook and each lifecycle
 * transition increment `mesomed.booking.created{kind}` /
 * `mesomed.booking.transitions{action}`, observed through a real
 * MeterProvider registered exactly the way production does it (see
 * metrics-setup.ts for the ordering constraint).
 */

describe("booking funnel metrics", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let slots: Array<{ startsAt: string; endsAt: string }>;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);
    slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
    await provider.shutdown();
    metrics.disable();
  });

  async function dataPoints(name: string): Promise<Map<string, number>> {
    await provider.forceFlush();
    const all = exporter.getMetrics();
    const points = new Map<string, number>();
    for (const resource of all) {
      for (const scope of resource.scopeMetrics) {
        for (const metric of scope.metrics) {
          if (metric.descriptor.name !== name) continue;
          for (const point of metric.dataPoints) {
            points.set(JSON.stringify(point.attributes), Number(point.value));
          }
        }
      }
    }
    return points;
  }

  it("counts guest bookings by channel and transitions by action", async () => {
    const booked = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: slots[0]!.startsAt,
      patient: { fullName: "Metrics Guest", phone: nextGuestPhone() },
    });
    expect(booked.statusCode).toBe(200);
    const { appointmentId } = result<{ appointmentId: string }>(booked);

    const confirmed = await trpc(
      app,
      "booking.confirm",
      "mutation",
      { appointmentId },
      { roles: "secretary", user: clinic.secretaryUserId },
    );
    expect(confirmed.statusCode).toBe(200);

    const created = await dataPoints("mesomed.booking.created");
    expect(created.get(JSON.stringify({ kind: "guest_web" }))).toBe(1);

    const transitions = await dataPoints("mesomed.booking.transitions");
    expect(transitions.get(JSON.stringify({ action: "confirm" }))).toBe(1);
  });

  it("does not count a rejected transition", async () => {
    const before = await dataPoints("mesomed.booking.transitions");

    // A second confirm on an already-confirmed appointment is rejected by
    // the edge-source gate before any state change.
    const booked = await trpc(app, "booking.guestBook", "mutation", {
      doctorLocationId: clinic.doctorLocationId,
      startsAt: slots[1]!.startsAt,
      patient: { fullName: "Metrics Guest 2", phone: nextGuestPhone() },
    });
    const { appointmentId } = result<{ appointmentId: string }>(booked);
    const secretary = { roles: "secretary", user: clinic.secretaryUserId } as const;
    await trpc(app, "booking.confirm", "mutation", { appointmentId }, secretary);
    const again = await trpc(app, "booking.confirm", "mutation", { appointmentId }, secretary);
    expect(again.statusCode).not.toBe(200);

    const after = await dataPoints("mesomed.booking.transitions");
    const confirmKey = JSON.stringify({ action: "confirm" });
    expect(after.get(confirmKey)).toBe((before.get(confirmKey) ?? 0) + 1);
  });
});
