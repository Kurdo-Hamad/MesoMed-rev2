import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  myClinicalRecordOutputSchema,
  patientClinicalHistoryOutputSchema,
} from "@mesomed/contracts/clinical";
import { and, clinicalAccessLog, eq } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  ADMIN,
  buildBookingTestServer,
  openSlotsNextWeek,
  result,
  seedClinic,
  trpc,
  type CallOptions,
  type ClinicFixture,
} from "../booking/helpers.js";
import { appCode, completeAppointment, doctorSession, patientSession } from "./helpers.js";

/**
 * Clinical extension gate (ADR-0010), criterion 1: continuity of care.
 * Doctor B holds a treating relationship through a merely BOOKED
 * appointment (never completed — no encounter exists for it) and
 * retrieves the patient's full history including Doctor A's prescriptions
 * with the complete, correctly ordered revision chain; before that booking
 * exists, the same doctor is FORBIDDEN. Every prescription read is
 * audit-logged. The patient reads their own record: prescriptions with
 * revision history, medical profile, reported medications — visit notes
 * deliberately absent, prescriptions never merged with reported meds.
 */
describe("clinical history: continuity of care and patient self-view", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let encounterId: string;
  let patientProfileId: string;
  let originalId: string;
  let amendment1Id: string;
  let amendment2Id: string;
  let discontinuedId: string;

  const doctorB = (): CallOptions => ({ roles: "doctor", user: clinic.otherDoctorUserId });

  async function mutate<T>(procedure: string, input: unknown, session?: CallOptions): Promise<T> {
    const res = await trpc(app, procedure, "mutation", input, session);
    if (res.statusCode !== 200) {
      throw new Error(`${procedure} failed in fixture: ${res.statusCode} ${res.body}`);
    }
    return result<T>(res);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);
    ({ encounterId } = await completeAppointment(app, clinic));

    // Doctor A's clinical record: a visit note, a prescription amended
    // twice (3-revision chain), and a second prescription discontinued.
    await mutate(
      "clinical.addVisitNote",
      { encounterId, content: "history fixture note" },
      doctorSession(clinic),
    );
    const content = {
      medicationName: "Metformin",
      dosage: "500 mg",
      frequency: "2x daily",
      duration: "30 days",
    };
    ({ prescriptionId: originalId } = await mutate<{ prescriptionId: string }>(
      "clinical.issuePrescription",
      { encounterId, ...content },
      doctorSession(clinic),
    ));
    ({ prescriptionId: amendment1Id } = await mutate<{ prescriptionId: string }>(
      "clinical.amendPrescription",
      { prescriptionId: originalId, ...content, dosage: "850 mg" },
      doctorSession(clinic),
    ));
    ({ prescriptionId: amendment2Id } = await mutate<{ prescriptionId: string }>(
      "clinical.amendPrescription",
      { prescriptionId: amendment1Id, ...content, dosage: "1000 mg" },
      doctorSession(clinic),
    ));
    ({ prescriptionId: discontinuedId } = await mutate<{ prescriptionId: string }>(
      "clinical.issuePrescription",
      {
        encounterId,
        medicationName: "Aspirin",
        dosage: "75 mg",
        frequency: "1x daily",
        duration: "90 days",
      },
      doctorSession(clinic),
    ));
    await mutate(
      "clinical.discontinuePrescription",
      { prescriptionId: discontinuedId },
      doctorSession(clinic),
    );

    // The patient's own contributions.
    const profile = await mutate<{ patientProfileId: string }>(
      "clinical.upsertMedicalProfile",
      { bloodType: "O+", allergies: ["penicillin"], notes: "hypertension" },
      patientSession(clinic),
    );
    patientProfileId = profile.patientProfileId;
    await mutate(
      "clinical.addReportedMedication",
      { medicationName: "Vitamin D", source: "over_the_counter" },
      patientSession(clinic),
    );
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("a doctor with NO treating relationship → typed FORBIDDEN", async () => {
    const res = await trpc(
      app,
      "clinical.patientClinicalHistory",
      "query",
      { patientProfileId },
      doctorB(),
    );
    expect(res.statusCode).toBe(403);
    expect(appCode(res)).toBe("FORBIDDEN");
  });

  it("a merely BOOKED appointment establishes the treating relationship for Doctor B", async () => {
    // Doctor B gets a schedule and the patient books — and never completes.
    await mutate(
      "scheduling.setWeeklySchedule",
      {
        doctorLocationId: clinic.otherDoctorLocationId,
        schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: "09:00",
          endTime: "17:00",
          slotDurationMinutes: 30,
          breaks: [],
        })),
      },
      ADMIN,
    );
    const [slot] = await openSlotsNextWeek(app, clinic.otherDoctorLocationId);
    await mutate("booking.guestBook", {
      doctorLocationId: clinic.otherDoctorLocationId,
      startsAt: slot!.startsAt,
      patient: { fullName: "Claimed Patient", phone: clinic.patientPhone },
    });

    const res = await trpc(
      app,
      "clinical.patientClinicalHistory",
      "query",
      { patientProfileId },
      doctorB(),
    );
    expect(res.statusCode).toBe(200);
    const body = patientClinicalHistoryOutputSchema.parse(result(res));

    // Doctor A's encounter, notes and prescriptions are all visible.
    expect(body.encounters.map((e) => e.encounterId)).toContain(encounterId);
    expect(
      body.visitNotes
        .find((group) => group.encounterId === encounterId)
        ?.notes.map((n) => n.content),
    ).toContain("history fixture note");

    // Complete, correctly ordered revision chain: original → amendment 1
    // → amendment 2, statuses superseded/superseded/active.
    const metforminChain = body.prescriptionChains.find(
      (chain) => chain.revisions[0]!.prescriptionId === originalId,
    );
    expect(metforminChain!.revisions.map((r) => r.prescriptionId)).toEqual([
      originalId,
      amendment1Id,
      amendment2Id,
    ]);
    expect(metforminChain!.revisions.map((r) => r.status)).toEqual([
      "superseded",
      "superseded",
      "active",
    ]);
    expect(metforminChain!.revisions.map((r) => r.dosage)).toEqual(["500 mg", "850 mg", "1000 mg"]);
    expect(metforminChain!.revisions[0]!.doctorProfileId).toBe(clinic.doctorProfileId);

    // The discontinued prescription is its own single-revision chain.
    const aspirinChain = body.prescriptionChains.find(
      (chain) => chain.revisions[0]!.prescriptionId === discontinuedId,
    );
    expect(aspirinChain!.revisions).toHaveLength(1);
    expect(aspirinChain!.revisions[0]!.status).toBe("discontinued");

    // Patient-authored data rides along — structurally separate arrays.
    expect(body.medicalProfile).toMatchObject({ bloodType: "O+", allergies: ["penicillin"] });
    expect(body.reportedMedications.map((m) => m.medicationName)).toEqual(["Vitamin D"]);
    expect(
      body.prescriptionChains
        .flatMap((c) => c.revisions)
        .some((r) => r.medicationName === "Vitamin D"),
    ).toBe(false);
  });

  it("Doctor B's prescription reads were audit-logged by the DB channel", async () => {
    const reads = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.action, "prescriptions_read"),
          eq(clinicalAccessLog.actorUserId, clinic.otherDoctorUserId),
        ),
      );
    // One row per prescription revision returned (4 revisions).
    expect(reads.length).toBeGreaterThanOrEqual(4);
    expect(reads.every((row) => row.prescriptionId !== null)).toBe(true);
  });

  it("patient reads own record: revision history included, visit notes absent", async () => {
    const res = await trpc(
      app,
      "clinical.myClinicalRecord",
      "query",
      undefined,
      patientSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const raw = result<Record<string, unknown>>(res);
    const body = myClinicalRecordOutputSchema.parse(raw);

    expect(body.patientProfileId).toBe(patientProfileId);
    const chain = body.prescriptionChains.find(
      (c) => c.revisions[0]!.prescriptionId === originalId,
    );
    expect(chain!.revisions.map((r) => r.status)).toEqual(["superseded", "superseded", "active"]);
    expect(body.medicalProfile?.bloodType).toBe("O+");
    expect(body.reportedMedications).toHaveLength(1);

    // Patient visit-note visibility is OUT of scope (ADR-0010): the
    // payload has no notes field of any kind.
    expect(Object.keys(raw).sort()).toEqual([
      "medicalProfile",
      "patientProfileId",
      "prescriptionChains",
      "reportedMedications",
    ]);
  });

  it("another patient's record does not leak: other patient sees an empty record", async () => {
    const res = await trpc(app, "clinical.myClinicalRecord", "query", undefined, {
      roles: "patient",
      user: clinic.otherPatientUserId,
    });
    expect(res.statusCode).toBe(200);
    const body = myClinicalRecordOutputSchema.parse(result(res));
    expect(body.prescriptionChains).toHaveLength(0);
    expect(body.reportedMedications).toHaveLength(0);
    expect(body.medicalProfile).toBeNull();
  });

  it("secretary/admin have no history path at all (role guard)", async () => {
    for (const roles of ["secretary", "admin"]) {
      const res = await trpc(
        app,
        "clinical.patientClinicalHistory",
        "query",
        { patientProfileId },
        { roles },
      );
      expect(res.statusCode).toBe(403);
    }
  });
});
