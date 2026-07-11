import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { listEncountersOutputSchema } from "@mesomed/contracts/clinical";
import {
  and,
  appointments,
  clinicalAccessLog,
  domainEvents,
  encounters,
  eq,
  processedEvents,
} from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { ON_BOOKING_COMPLETED_HANDLER } from "../../src/modules/clinical/events/on-booking-completed.js";
import {
  buildBookingTestServer,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";
import { completeAppointment, doctorSession, patientSession } from "./helpers.js";

/**
 * Phase 5 gate: encounters exist 1:1 with completed appointments, created
 * exclusively by the idempotent subscriber on booking.completed.v1 —
 * redelivery is a provable no-op at both layers (processed_events claim
 * AND the appointment unique index), and the DB audit trigger records the
 * creation.
 */
describe("encounter creation from booking.completed.v1", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let appointmentId: string;
  let encounterId: string;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);
    ({ appointmentId, encounterId } = await completeAppointment(app, clinic));
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("creates the encounter with the appointment snapshot denormalized", async () => {
    const [encounter] = await tdb.db
      .select()
      .from(encounters)
      .where(eq(encounters.id, encounterId));
    const [appointment] = await tdb.db
      .select()
      .from(appointments)
      .where(eq(appointments.id, appointmentId));

    expect(encounter).toBeDefined();
    expect(encounter!.appointmentId).toBe(appointmentId);
    expect(encounter!.doctorProfileId).toBe(clinic.doctorProfileId);
    expect(encounter!.patientProfileId).toBe(appointment!.patientProfileId);
    expect(encounter!.startsAt.toISOString()).toBe(appointment!.startsAt.toISOString());
    expect(encounter!.endsAt.toISOString()).toBe(appointment!.endsAt.toISOString());
  });

  it("audit: the DB trigger logged encounter_created with the system actor", async () => {
    const rows = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.encounterId, encounterId),
          eq(clinicalAccessLog.action, "encounter_created"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe("system:outbox");
  });

  it("emits clinical.encounter_created.v1 (ids only) in the subscriber's transaction", async () => {
    const rows = await tdb.db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.name, "clinical.encounter_created.v1"),
          eq(domainEvents.aggregateId, encounterId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      encounterId,
      appointmentId,
      doctorProfileId: clinic.doctorProfileId,
    });
  });

  it("redelivery is a no-op: idempotency claim absorbs it, unique index backstops it", async () => {
    const [completedEvent] = await tdb.db
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.name, "booking.completed.v1"),
          eq(domainEvents.aggregateId, appointmentId),
        ),
      );
    expect(completedEvent).toBeDefined();

    // Layer 1: the processed_events claim makes redelivery a no-op.
    await app.kernel.dispatcher.redeliver(completedEvent!.id);

    // Layer 2: even with the claim erased (simulated handler-registry
    // change), ON CONFLICT on the appointment unique index absorbs it.
    await tdb.db
      .delete(processedEvents)
      .where(
        and(
          eq(processedEvents.eventId, completedEvent!.id),
          eq(processedEvents.handler, ON_BOOKING_COMPLETED_HANDLER),
        ),
      );
    await app.kernel.dispatcher.redeliver(completedEvent!.id);

    const encounterRows = await tdb.db
      .select({ id: encounters.id })
      .from(encounters)
      .where(eq(encounters.appointmentId, appointmentId));
    expect(encounterRows).toHaveLength(1);

    // No duplicate created-event, no duplicate audit row.
    const createdEvents = await tdb.db
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.name, "clinical.encounter_created.v1"),
          eq(domainEvents.aggregateId, encounterId),
        ),
      );
    expect(createdEvents).toHaveLength(1);
    const auditRows = await tdb.db
      .select({ id: clinicalAccessLog.id })
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.encounterId, encounterId),
          eq(clinicalAccessLog.action, "encounter_created"),
        ),
      );
    expect(auditRows).toHaveLength(1);
  });

  it("doctor lists own encounters through the audited channel (contract-valid)", async () => {
    const res = await trpc(
      app,
      "clinical.doctorEncounters",
      "query",
      undefined,
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = listEncountersOutputSchema.parse(result(res));
    expect(body.encounters.some((e) => e.encounterId === encounterId)).toBe(true);

    const reads = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.encounterId, encounterId),
          eq(clinicalAccessLog.action, "encounter_read"),
        ),
      );
    expect(reads.some((row) => row.actorUserId === clinic.doctorUserId)).toBe(true);
  });

  it("patient lists own encounters (contract-valid, audited)", async () => {
    const res = await trpc(
      app,
      "clinical.myEncounters",
      "query",
      undefined,
      patientSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = listEncountersOutputSchema.parse(result(res));
    expect(body.encounters.some((e) => e.encounterId === encounterId)).toBe(true);

    const reads = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.encounterId, encounterId),
          eq(clinicalAccessLog.action, "encounter_read"),
        ),
      );
    expect(reads.some((row) => row.actorUserId === clinic.patientUserId)).toBe(true);
  });
});
