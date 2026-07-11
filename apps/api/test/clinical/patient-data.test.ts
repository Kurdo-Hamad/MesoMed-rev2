import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { medicalProfileSchema, reportedMedicationSchema } from "@mesomed/contracts/clinical";
import {
  eq,
  patientMedicalProfiles,
  patientProfiles,
  patientReportedMedications,
} from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";
import { appCode, doctorSession, patientSession } from "./helpers.js";

/**
 * Clinical extension gate (ADR-0010), criterion 2: patient-authored data.
 * The medical profile is a free upsert with NO revision history (option A
 * — locked); reported medications add/remove freely (hard delete). Both
 * are keyed by the SESSION's claimed patient profile, so cross-patient
 * writes are impossible by construction — proven here by observing the
 * other patient's rows. Doctors are read-only (write denied at the role
 * guard).
 */
describe("patient medical profile and reported medications", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let patientProfileId: string;
  let otherPatientProfileId: string;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);

    const profiles = await tdb.db
      .select({ id: patientProfiles.id, userId: patientProfiles.userId })
      .from(patientProfiles);
    patientProfileId = profiles.find((p) => p.userId === clinic.patientUserId)!.id;
    otherPatientProfileId = profiles.find((p) => p.userId === clinic.otherPatientUserId)!.id;

    // The other patient's pre-existing profile row — the cross-patient
    // canary every denial test asserts against.
    await trpc(
      app,
      "clinical.upsertMedicalProfile",
      "mutation",
      { bloodType: "O-", allergies: ["latex"] },
      { roles: "patient", user: clinic.otherPatientUserId },
    );
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("upsert creates the patient's own profile row (contract-valid)", async () => {
    const res = await trpc(
      app,
      "clinical.upsertMedicalProfile",
      "mutation",
      { bloodType: "A+", allergies: ["penicillin", "peanuts"], notes: "asthma since childhood" },
      patientSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = medicalProfileSchema.parse(result(res));
    expect(body).toMatchObject({
      patientProfileId,
      bloodType: "A+",
      allergies: ["penicillin", "peanuts"],
      notes: "asthma since childhood",
    });
  });

  it("upsert overwrites in place: one row per patient, no revision history", async () => {
    const res = await trpc(
      app,
      "clinical.upsertMedicalProfile",
      "mutation",
      { bloodType: "AB-", allergies: [] },
      patientSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = medicalProfileSchema.parse(result(res));
    expect(body).toMatchObject({ bloodType: "AB-", allergies: [], notes: null });

    const rows = await tdb.db
      .select()
      .from(patientMedicalProfiles)
      .where(eq(patientMedicalProfiles.patientProfileId, patientProfileId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bloodType).toBe("AB-");
  });

  it("cross-patient write is impossible: A's upsert never touches B's row", async () => {
    const [before] = await tdb.db
      .select()
      .from(patientMedicalProfiles)
      .where(eq(patientMedicalProfiles.patientProfileId, otherPatientProfileId));
    expect(before!.bloodType).toBe("O-");

    // The input carries no patient id at all — the session decides the row.
    await trpc(
      app,
      "clinical.upsertMedicalProfile",
      "mutation",
      { bloodType: "B+", allergies: ["dust"] },
      patientSession(clinic),
    );

    const [after] = await tdb.db
      .select()
      .from(patientMedicalProfiles)
      .where(eq(patientMedicalProfiles.patientProfileId, otherPatientProfileId));
    expect(after).toEqual(before);
  });

  it("doctor write to the profile → 403 (doctors are read-only)", async () => {
    const res = await trpc(
      app,
      "clinical.upsertMedicalProfile",
      "mutation",
      { bloodType: "A+", allergies: [] },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(403);
    expect(appCode(res)).toBe("FORBIDDEN");
  });

  it("patient session without a claimed profile → 403", async () => {
    const res = await trpc(
      app,
      "clinical.upsertMedicalProfile",
      "mutation",
      { bloodType: "A+", allergies: [] },
      { roles: "patient", user: "session-without-profile" },
    );
    expect(res.statusCode).toBe(403);
  });

  it("rejects out-of-contract blood type with 400", async () => {
    const res = await trpc(
      app,
      "clinical.upsertMedicalProfile",
      "mutation",
      { bloodType: "C+", allergies: [] },
      patientSession(clinic),
    );
    expect(res.statusCode).toBe(400);
  });

  let reportedMedicationId: string;

  it("add reported medication under the session's own profile (contract-valid)", async () => {
    const res = await trpc(
      app,
      "clinical.addReportedMedication",
      "mutation",
      { medicationName: "Ibuprofen", dosage: "200 mg", source: "over_the_counter" },
      patientSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = reportedMedicationSchema.parse(result(res));
    reportedMedicationId = body.reportedMedicationId;
    expect(body).toMatchObject({
      patientProfileId,
      medicationName: "Ibuprofen",
      source: "over_the_counter",
      notes: null,
    });
  });

  it("doctor write to reported medications → 403 (read-only)", async () => {
    const res = await trpc(
      app,
      "clinical.addReportedMedication",
      "mutation",
      { medicationName: "X", source: "self_prescribed" },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(403);
  });

  it("another patient cannot remove A's medication — indistinguishable from missing", async () => {
    const res = await trpc(
      app,
      "clinical.removeReportedMedication",
      "mutation",
      { reportedMedicationId },
      { roles: "patient", user: clinic.otherPatientUserId },
    );
    expect(res.statusCode).toBe(404);
    expect(appCode(res)).toBe("NOT_FOUND");

    const rows = await tdb.db
      .select({ id: patientReportedMedications.id })
      .from(patientReportedMedications)
      .where(eq(patientReportedMedications.id, reportedMedicationId));
    expect(rows).toHaveLength(1);
  });

  it("owner removes their medication — hard delete (not a clinical record)", async () => {
    const res = await trpc(
      app,
      "clinical.removeReportedMedication",
      "mutation",
      { reportedMedicationId },
      patientSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    expect(result(res)).toEqual({ reportedMedicationId, removed: true });

    const rows = await tdb.db
      .select({ id: patientReportedMedications.id })
      .from(patientReportedMedications)
      .where(eq(patientReportedMedications.id, reportedMedicationId));
    expect(rows).toHaveLength(0);

    const again = await trpc(
      app,
      "clinical.removeReportedMedication",
      "mutation",
      { reportedMedicationId },
      patientSession(clinic),
    );
    expect(again.statusCode).toBe(404);
  });
});
