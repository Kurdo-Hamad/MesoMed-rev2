/**
 * Clinical history reads (clinical extension, ADR-0010).
 *
 * Doctor view — continuity of care: a doctor with a treating relationship
 * (≥1 appointment in a treating status, checked via published queries in
 * `requireTreatingDoctor`) reads the patient's encounters, visit notes,
 * full prescription revision chains, medical profile and reported
 * medications. Clinical-tier reads flow through the audited SECURITY
 * DEFINER channel; patient-authored tables are ordinary reads (no audit —
 * deliberate, ADR-0010).
 *
 * Patient view — own prescriptions (with revision history), own medical
 * profile, own reported medications. Visit-note visibility for patients
 * is explicitly OUT of scope (ADR-0010).
 *
 * Prescriptions and patient-reported medications are structurally
 * distinct arrays in every payload — never merged into one list.
 */
import { buildPrescriptionRevisionChains } from "@mesomed/domain/clinical";
import {
  eq,
  patientMedicalProfiles,
  patientReportedMedications,
  type DbExecutor,
} from "@mesomed/db";
import type { Session } from "../../../kernel/context.js";
import {
  readEncounters,
  readPrescriptionRows,
  readVisitNotes,
  requirePatientProfileId,
  requireTreatingDoctor,
  type PrescriptionRow,
} from "../shared.js";
import {
  toEncounterView,
  toVisitNoteView,
  type EncounterView,
  type VisitNoteView,
} from "./encounters.js";

export interface PrescriptionView {
  prescriptionId: string;
  encounterId: string;
  doctorProfileId: string;
  patientProfileId: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
  status: "active" | "superseded" | "discontinued";
  supersedesPrescriptionId: string | null;
  issuedAt: string;
  createdAt: string;
}

function toPrescriptionView(row: PrescriptionRow): PrescriptionView {
  return {
    prescriptionId: row.id,
    encounterId: row.encounterId,
    doctorProfileId: row.doctorProfileId,
    patientProfileId: row.patientProfileId,
    medicationName: row.medicationName,
    dosage: row.dosage,
    frequency: row.frequency,
    duration: row.duration,
    instructions: row.instructions,
    status: row.status,
    supersedesPrescriptionId: row.supersedesPrescriptionId,
    issuedAt: row.issuedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PrescriptionChainView {
  /** Original first, latest revision last. */
  revisions: PrescriptionView[];
}

/**
 * Chains from the channel's newest-first rows: heads keep that order, so
 * chains arrive newest-original-first; within a chain the domain function
 * restores original → latest.
 */
function toChainViews(rows: PrescriptionRow[]): PrescriptionChainView[] {
  return buildPrescriptionRevisionChains(rows).map((chain) => ({
    revisions: chain.revisions.map(toPrescriptionView),
  }));
}

export interface MedicalProfileView {
  patientProfileId: string;
  bloodType: (typeof patientMedicalProfiles.bloodType.enumValues)[number];
  allergies: string[];
  notes: string | null;
  updatedAt: string;
}

export interface ReportedMedicationView {
  reportedMedicationId: string;
  patientProfileId: string;
  medicationName: string;
  dosage: string | null;
  source: (typeof patientReportedMedications.source.enumValues)[number];
  notes: string | null;
  createdAt: string;
}

async function readMedicalProfile(
  db: DbExecutor,
  patientProfileId: string,
): Promise<MedicalProfileView | null> {
  const [row] = await db
    .select()
    .from(patientMedicalProfiles)
    .where(eq(patientMedicalProfiles.patientProfileId, patientProfileId))
    .limit(1);
  if (!row) return null;
  return {
    patientProfileId: row.patientProfileId,
    bloodType: row.bloodType,
    allergies: row.allergies,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readReportedMedications(
  db: DbExecutor,
  patientProfileId: string,
): Promise<ReportedMedicationView[]> {
  const rows = await db
    .select()
    .from(patientReportedMedications)
    .where(eq(patientReportedMedications.patientProfileId, patientProfileId))
    .orderBy(patientReportedMedications.createdAt, patientReportedMedications.id);
  return rows.map((row) => ({
    reportedMedicationId: row.id,
    patientProfileId: row.patientProfileId,
    medicationName: row.medicationName,
    dosage: row.dosage,
    source: row.source,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface PatientClinicalHistoryView {
  patientProfileId: string;
  encounters: EncounterView[];
  visitNotes: { encounterId: string; notes: VisitNoteView[] }[];
  prescriptionChains: PrescriptionChainView[];
  medicalProfile: MedicalProfileView | null;
  reportedMedications: ReportedMedicationView[];
}

/** Doctor's cross-encounter view of one patient (continuity of care). */
export async function getPatientClinicalHistory(
  db: DbExecutor,
  session: Session,
  input: { patientProfileId: string },
): Promise<PatientClinicalHistoryView> {
  await requireTreatingDoctor(db, session, input.patientProfileId);

  const encounters = await readEncounters(db, session.userId, {
    patientProfileId: input.patientProfileId,
  });
  const visitNotes = [];
  for (const encounter of encounters) {
    const notes = await readVisitNotes(db, session.userId, encounter.id);
    visitNotes.push({ encounterId: encounter.id, notes: notes.map(toVisitNoteView) });
  }
  const prescriptions = await readPrescriptionRows(db, session.userId, {
    patientProfileId: input.patientProfileId,
  });

  return {
    patientProfileId: input.patientProfileId,
    encounters: encounters.map(toEncounterView),
    visitNotes,
    prescriptionChains: toChainViews(prescriptions),
    medicalProfile: await readMedicalProfile(db, input.patientProfileId),
    reportedMedications: await readReportedMedications(db, input.patientProfileId),
  };
}

export interface MyClinicalRecordView {
  patientProfileId: string;
  prescriptionChains: PrescriptionChainView[];
  medicalProfile: MedicalProfileView | null;
  reportedMedications: ReportedMedicationView[];
}

/** Patient self-view. Visit notes are deliberately absent (ADR-0010). */
export async function getMyClinicalRecord(
  db: DbExecutor,
  session: Session,
): Promise<MyClinicalRecordView> {
  const patientProfileId = await requirePatientProfileId(db, session);

  const prescriptions = await readPrescriptionRows(db, session.userId, { patientProfileId });

  return {
    patientProfileId,
    prescriptionChains: toChainViews(prescriptions),
    medicalProfile: await readMedicalProfile(db, patientProfileId),
    reportedMedications: await readReportedMedications(db, patientProfileId),
  };
}
