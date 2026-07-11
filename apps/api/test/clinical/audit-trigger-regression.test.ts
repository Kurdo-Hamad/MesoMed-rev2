import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, clinicalAccessLog, eq } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";
import { completeAppointment, doctorSession } from "./helpers.js";

/**
 * Post-merge verification (ADR-0010, architecture risk register R8):
 * migration 0007 widened `clinical_audit_row()` via CREATE OR REPLACE
 * FUNCTION to add prescriptions logging alongside the Phase-5
 * encounters/visit_notes logging. A mis-replace of that function could
 * silently degrade the Phase-5 audit trail even while prescriptions
 * auditing works correctly — CREATE OR REPLACE preserves the function's
 * OID and every trigger already pointing at it (`encounters_audit`,
 * `visit_notes_audit`), so a body regression would not be caught by
 * signature/attachment checks alone, only by observing behavior.
 *
 * This is a single regression test exercising all three clinical-tier
 * tables end to end and asserting their audit rows match the exact shape
 * the original Phase-5 gate asserted (encounter.test.ts, notes.test.ts) —
 * not a new, looser assertion.
 */
describe("audit trigger regression: encounters, visit_notes and prescriptions all still audit correctly post-ADR-0010", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let encounterId: string;
  let visitNoteId: string;
  let prescriptionId: string;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);

    // The encounters write: the booking.completed.v1 subscriber is the
    // only path that inserts into encounters (§3.5/router.ts header) —
    // this establishes the doctor's treating relationship with the patient
    // that the visit-note and prescription writes below rely on.
    ({ encounterId } = await completeAppointment(app, clinic));

    // The visit_notes write, by the owning doctor.
    const noteRes = await trpc(
      app,
      "clinical.addVisitNote",
      "mutation",
      { encounterId, content: "audit regression fixture note" },
      doctorSession(clinic),
    );
    if (noteRes.statusCode !== 200) {
      throw new Error(`fixture note failed: ${noteRes.body}`);
    }
    visitNoteId = result<{ visitNoteId: string }>(noteRes).visitNoteId;

    // The prescriptions write, by the owning doctor.
    const rxRes = await trpc(
      app,
      "clinical.issuePrescription",
      "mutation",
      {
        encounterId,
        medicationName: "Audit Regression Med",
        dosage: "1 mg",
        frequency: "1x daily",
        duration: "1 day",
      },
      doctorSession(clinic),
    );
    if (rxRes.statusCode !== 200) {
      throw new Error(`fixture prescription failed: ${rxRes.body}`);
    }
    prescriptionId = result<{ prescriptionId: string }>(rxRes).prescriptionId;
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  // ── Same assertions as the original Phase-5 gate, unchanged ──────────
  // (encounter.test.ts: "audit: the DB trigger logged encounter_created
  // with the system actor" — filter, length, and actor assertion below
  // are identical to that test.)

  it("encounters: the DB trigger still logs encounter_created with the system actor", async () => {
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

  // (notes.test.ts: "owning doctor adds a note; the DB trigger logs
  // note_added" — filter, length, and actor assertion below are identical
  // to that test.)

  it("visit_notes: the DB trigger still logs note_added with the doctor actor", async () => {
    const audit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.visitNoteId, visitNoteId),
          eq(clinicalAccessLog.action, "note_added"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(clinic.doctorUserId);
  });

  // (prescriptions.test.ts: "issue: owning doctor creates an active
  // revision (contract-valid, audited, event once)" — same shape, proven
  // here alongside the other two tables in one regression file.)

  it("prescriptions: the widened trigger logs prescription_issued with the doctor actor", async () => {
    const audit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.prescriptionId, prescriptionId),
          eq(clinicalAccessLog.action, "prescription_issued"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(clinic.doctorUserId);
  });

  it("all three tables produced exactly one audit row each, through the same widened function, with no cross-contamination", async () => {
    const rows = await tdb.db
      .select({
        action: clinicalAccessLog.action,
        encounterId: clinicalAccessLog.encounterId,
        visitNoteId: clinicalAccessLog.visitNoteId,
        prescriptionId: clinicalAccessLog.prescriptionId,
        actorUserId: clinicalAccessLog.actorUserId,
      })
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.encounterId, encounterId),
          eq(clinicalAccessLog.action, "encounter_created"),
        ),
      )
      .union(
        tdb.db
          .select({
            action: clinicalAccessLog.action,
            encounterId: clinicalAccessLog.encounterId,
            visitNoteId: clinicalAccessLog.visitNoteId,
            prescriptionId: clinicalAccessLog.prescriptionId,
            actorUserId: clinicalAccessLog.actorUserId,
          })
          .from(clinicalAccessLog)
          .where(
            and(
              eq(clinicalAccessLog.visitNoteId, visitNoteId),
              eq(clinicalAccessLog.action, "note_added"),
            ),
          ),
      )
      .union(
        tdb.db
          .select({
            action: clinicalAccessLog.action,
            encounterId: clinicalAccessLog.encounterId,
            visitNoteId: clinicalAccessLog.visitNoteId,
            prescriptionId: clinicalAccessLog.prescriptionId,
            actorUserId: clinicalAccessLog.actorUserId,
          })
          .from(clinicalAccessLog)
          .where(
            and(
              eq(clinicalAccessLog.prescriptionId, prescriptionId),
              eq(clinicalAccessLog.action, "prescription_issued"),
            ),
          ),
      );

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.action).sort()).toEqual([
      "encounter_created",
      "note_added",
      "prescription_issued",
    ]);
    // Each row is scoped to its own table's id column only — the widened
    // function never writes a foreign id into the wrong column.
    const byAction = Object.fromEntries(rows.map((r) => [r.action, r]));
    expect(byAction.encounter_created).toMatchObject({
      visitNoteId: null,
      prescriptionId: null,
      actorUserId: "system:outbox",
    });
    expect(byAction.note_added).toMatchObject({
      prescriptionId: null,
      actorUserId: clinic.doctorUserId,
    });
    expect(byAction.prescription_issued).toMatchObject({
      visitNoteId: null,
      actorUserId: clinic.doctorUserId,
    });
  });
});
