import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AnyEventEnvelope } from "@mesomed/contracts/events";
import { prescriptionResultSchema } from "@mesomed/contracts/clinical";
import { and, clinicalAccessLog, domainEvents, eq, prescriptions } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { createHandlerRegistry } from "../../src/kernel/events.js";
import {
  buildBookingTestServer,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";
import { waitFor } from "../helpers.js";
import { appCode, completeAppointment, doctorSession, patientSession } from "./helpers.js";

/**
 * Clinical extension gate (ADR-0010), criteria 2/3/5/6: prescription
 * commands are owning-doctor-only; amendment atomically creates the new
 * revision and supersedes its target; the DB guard trigger rejects content
 * tampering, illegal transitions and DELETE for every role; the audit
 * trigger logs every prescription read/write; all three events are
 * written to the outbox in the command tx and delivered exactly once to a
 * test-double subscriber (no communication-module code exists).
 */
describe("prescriptions: commands, immutability, audit, events", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let encounterId: string;

  const issuedDeliveries: AnyEventEnvelope[] = [];
  const amendedDeliveries: AnyEventEnvelope[] = [];
  const discontinuedDeliveries: AnyEventEnvelope[] = [];

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const handlers = createHandlerRegistry();
    handlers.on("clinical.prescription_issued.v1", "test.rx-issued", (envelope) => {
      issuedDeliveries.push(envelope);
    });
    handlers.on("clinical.prescription_amended.v1", "test.rx-amended", (envelope) => {
      amendedDeliveries.push(envelope);
    });
    handlers.on("clinical.prescription_discontinued.v1", "test.rx-discontinued", (envelope) => {
      discontinuedDeliveries.push(envelope);
    });

    app = await buildBookingTestServer(tdb.connectionString, { eventHandlers: handlers });
    await app.ready();
    clinic = await seedClinic(app);
    ({ encounterId } = await completeAppointment(app, clinic));
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  const CONTENT = {
    medicationName: "Amoxicillin",
    dosage: "500 mg",
    frequency: "3x daily",
    duration: "7 days",
    instructions: "Take with food",
  };

  let originalId: string;
  let amendmentId: string;

  it("issue: owning doctor creates an active revision (contract-valid, audited, event once)", async () => {
    const res = await trpc(
      app,
      "clinical.issuePrescription",
      "mutation",
      { encounterId, ...CONTENT },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = prescriptionResultSchema.parse(result(res));
    originalId = body.prescriptionId;
    expect(body).toMatchObject({ encounterId, status: "active", supersedesPrescriptionId: null });

    const [row] = await tdb.db
      .select()
      .from(prescriptions)
      .where(eq(prescriptions.id, originalId));
    expect(row).toMatchObject({
      encounterId,
      doctorProfileId: clinic.doctorProfileId,
      medicationName: CONTENT.medicationName,
      status: "active",
      supersedesPrescriptionId: null,
    });

    const audit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.prescriptionId, originalId),
          eq(clinicalAccessLog.action, "prescription_issued"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(clinic.doctorUserId);

    // Outbox row written in the command tx, ids only.
    const [event] = await tdb.db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.name, "clinical.prescription_issued.v1"),
          eq(domainEvents.aggregateId, originalId),
        ),
      );
    expect(event).toBeDefined();
    expect(event!.payload).toEqual({
      prescriptionId: originalId,
      encounterId,
      doctorProfileId: clinic.doctorProfileId,
      patientProfileId: row!.patientProfileId,
    });
    expect(JSON.stringify(event!.payload)).not.toContain("Amoxicillin");

    // Delivered exactly once to the test-double subscriber.
    await waitFor(async () => issuedDeliveries.length > 0);
    expect(issuedDeliveries).toHaveLength(1);
  });

  it("amend: new active revision + prior superseded, atomically (event once)", async () => {
    const res = await trpc(
      app,
      "clinical.amendPrescription",
      "mutation",
      { prescriptionId: originalId, ...CONTENT, dosage: "250 mg" },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = prescriptionResultSchema.parse(result(res));
    amendmentId = body.prescriptionId;
    expect(body).toMatchObject({ status: "active", supersedesPrescriptionId: originalId });

    const rows = await tdb.db
      .select()
      .from(prescriptions)
      .where(eq(prescriptions.encounterId, encounterId));
    const original = rows.find((r) => r.id === originalId);
    const amendment = rows.find((r) => r.id === amendmentId);
    expect(original!.status).toBe("superseded");
    expect(original!.dosage).toBe("500 mg"); // content untouched
    expect(amendment!.status).toBe("active");
    expect(amendment!.dosage).toBe("250 mg");
    expect(amendment!.supersedesPrescriptionId).toBe(originalId);

    const audit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.prescriptionId, amendmentId),
          eq(clinicalAccessLog.action, "prescription_amended"),
        ),
      );
    expect(audit).toHaveLength(1);

    await waitFor(async () => amendedDeliveries.length > 0);
    expect(amendedDeliveries).toHaveLength(1);
    expect(amendedDeliveries[0]!.payload).toMatchObject({
      prescriptionId: amendmentId,
      supersedesPrescriptionId: originalId,
    });
  });

  it("amend a superseded revision → typed PRESCRIPTION_NOT_ACTIVE", async () => {
    const res = await trpc(
      app,
      "clinical.amendPrescription",
      "mutation",
      { prescriptionId: originalId, ...CONTENT },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(409);
    expect(appCode(res)).toBe("PRESCRIPTION_NOT_ACTIVE");
  });

  it("discontinue: active revision flips, content untouched (audited, event once)", async () => {
    const res = await trpc(
      app,
      "clinical.discontinuePrescription",
      "mutation",
      { prescriptionId: amendmentId },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = prescriptionResultSchema.parse(result(res));
    expect(body.status).toBe("discontinued");

    const [row] = await tdb.db
      .select()
      .from(prescriptions)
      .where(eq(prescriptions.id, amendmentId));
    expect(row!.status).toBe("discontinued");
    expect(row!.dosage).toBe("250 mg");

    const audit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.prescriptionId, amendmentId),
          eq(clinicalAccessLog.action, "prescription_discontinued"),
        ),
      );
    expect(audit).toHaveLength(1);

    await waitFor(async () => discontinuedDeliveries.length > 0);
    expect(discontinuedDeliveries).toHaveLength(1);
  });

  it("discontinue a non-active revision → typed PRESCRIPTION_NOT_ACTIVE", async () => {
    for (const prescriptionId of [originalId, amendmentId]) {
      const res = await trpc(
        app,
        "clinical.discontinuePrescription",
        "mutation",
        { prescriptionId },
        doctorSession(clinic),
      );
      expect(res.statusCode).toBe(409);
      expect(appCode(res)).toBe("PRESCRIPTION_NOT_ACTIVE");
    }
  });

  // ── Layer a/b denials (gate criterion 2) ─────────────────────────────

  it("patient issue/amend/discontinue attempts → 403 at the role guard", async () => {
    for (const [procedure, input] of [
      ["clinical.issuePrescription", { encounterId, ...CONTENT }],
      ["clinical.amendPrescription", { prescriptionId: originalId, ...CONTENT }],
      ["clinical.discontinuePrescription", { prescriptionId: originalId }],
    ] as const) {
      const res = await trpc(app, procedure, "mutation", input, patientSession(clinic));
      expect(res.statusCode).toBe(403);
      expect(appCode(res)).toBe("FORBIDDEN");
    }
  });

  it("a doctor who does not own the encounter cannot issue/amend/discontinue", async () => {
    const intruder = { roles: "doctor", user: clinic.otherDoctorUserId };
    for (const [procedure, input] of [
      ["clinical.issuePrescription", { encounterId, ...CONTENT }],
      ["clinical.amendPrescription", { prescriptionId: originalId, ...CONTENT }],
      ["clinical.discontinuePrescription", { prescriptionId: originalId }],
    ] as const) {
      const res = await trpc(app, procedure, "mutation", input, intruder);
      expect(res.statusCode).toBe(403);
      expect(appCode(res)).toBe("FORBIDDEN");
    }
    // Denied writes left nothing behind.
    const rows = await tdb.db
      .select({ id: prescriptions.id })
      .from(prescriptions)
      .where(eq(prescriptions.encounterId, encounterId));
    expect(rows).toHaveLength(2);
  });

  // ── DB-layer guard trigger meta-test (gate criterion 3) ──────────────

  it("DB layer: content tampering is rejected even for the table owner", async () => {
    await expect(
      tdb.pool.query("update prescriptions set medication_name = 'tampered' where id = $1", [
        originalId,
      ]),
    ).rejects.toThrow(/PRESCRIPTION_IMMUTABLE/);
    await expect(
      tdb.pool.query("update prescriptions set encounter_id = gen_random_uuid() where id = $1", [
        originalId,
      ]),
    ).rejects.toThrow(/PRESCRIPTION_IMMUTABLE/);
  });

  it("DB layer: illegal status transitions are rejected even for the table owner", async () => {
    // superseded → active (resurrection)
    await expect(
      tdb.pool.query("update prescriptions set status = 'active' where id = $1", [originalId]),
    ).rejects.toThrow(/PRESCRIPTION_STATUS_INVALID/);
    // superseded → discontinued (only active may flip)
    await expect(
      tdb.pool.query("update prescriptions set status = 'discontinued' where id = $1", [
        originalId,
      ]),
    ).rejects.toThrow(/PRESCRIPTION_STATUS_INVALID/);
    // discontinued → active (resurrection)
    await expect(
      tdb.pool.query("update prescriptions set status = 'active' where id = $1", [amendmentId]),
    ).rejects.toThrow(/PRESCRIPTION_STATUS_INVALID/);
  });

  it("DB layer: DELETE is rejected even for the table owner", async () => {
    await expect(
      tdb.pool.query("delete from prescriptions where id = $1", [originalId]),
    ).rejects.toThrow(/PRESCRIPTION_IMMUTABLE/);
  });

  it("DB layer: a second amendment of the same revision is blocked by the unique link", async () => {
    // The definer function rejects non-active targets first; the partial
    // unique index is the concurrency backstop underneath it.
    await expect(
      tdb.pool.query(
        `insert into prescriptions (encounter_id, doctor_profile_id, patient_profile_id,
           medication_name, dosage, frequency, duration, supersedes_prescription_id)
         select encounter_id, doctor_profile_id, patient_profile_id,
           medication_name, dosage, frequency, duration, $1::uuid
         from prescriptions where id = $1`,
        [originalId],
      ),
    ).rejects.toThrow(/prescriptions_supersedes_unique/);
  });

  it("events: exactly one delivery each, no extras after the full flow", () => {
    expect(issuedDeliveries).toHaveLength(1);
    expect(amendedDeliveries).toHaveLength(1);
    expect(discontinuedDeliveries).toHaveLength(1);
  });

  it("rejects out-of-contract input with 400 (empty medication name)", async () => {
    const res = await trpc(
      app,
      "clinical.issuePrescription",
      "mutation",
      { encounterId, ...CONTENT, medicationName: "" },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(400);
  });
});
