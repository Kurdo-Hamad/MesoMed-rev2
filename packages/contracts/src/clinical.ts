/**
 * Clinical module API contracts (MM-PLAN-001 §5 Phase 5). Router I/O is
 * typed here so web/mobile share one source of truth (§3.11/§3.12).
 *
 * Instants on the wire are ISO strings (UTC). Visit-note content crosses
 * the wire only in these procedure outputs — never in event payloads.
 */
import { z } from "zod";

export const encounterSchema = z.object({
  encounterId: z.string(),
  appointmentId: z.string(),
  doctorProfileId: z.string(),
  patientProfileId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  createdAt: z.string(),
});

export const listEncountersOutputSchema = z.object({
  encounters: z.array(encounterSchema),
});

export const encounterIdInputSchema = z.object({ encounterId: z.string().uuid() });

export const visitNoteSchema = z.object({
  visitNoteId: z.string(),
  encounterId: z.string(),
  /** Null on an original note; the amended note's id on an amendment. */
  amendsNoteId: z.string().nullable(),
  authorUserId: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

/** Notes of one encounter in creation order: originals with their amendments. */
export const visitNotesOutputSchema = z.object({
  encounterId: z.string(),
  notes: z.array(visitNoteSchema),
});

export const addVisitNoteInputSchema = z.object({
  encounterId: z.string().uuid(),
  content: z.string().min(1).max(20_000),
});

export const amendVisitNoteInputSchema = z.object({
  encounterId: z.string().uuid(),
  /** The ORIGINAL note being corrected — amendments never chain (§3.5). */
  visitNoteId: z.string().uuid(),
  content: z.string().min(1).max(20_000),
});

export const visitNoteResultSchema = z.object({
  visitNoteId: z.string(),
  encounterId: z.string(),
  amendsNoteId: z.string().nullable(),
});

// ── Support access (time-boxed admin grants, §3.5) ─────────────────────

export const grantSupportAccessInputSchema = z.object({
  encounterId: z.string().uuid(),
  /** Why support needs clinical access — mandatory, lands in the audit log. */
  reason: z.string().min(5).max(1_000),
  /** ISO instant; must be in the future and within the policy window. */
  expiresAt: z.iso.datetime(),
});

export const supportGrantSchema = z.object({
  grantId: z.string(),
  encounterId: z.string(),
  adminUserId: z.string(),
  grantedBy: z.string(),
  reason: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const grantSupportAccessResultSchema = z.object({
  grantId: z.string(),
  encounterId: z.string(),
  expiresAt: z.string(),
});

export const grantIdInputSchema = z.object({ grantId: z.string().uuid() });

export const revokeSupportAccessResultSchema = z.object({
  grantId: z.string(),
  /** False when the grant was already revoked (idempotent revoke). */
  revoked: z.boolean(),
});

export const listSupportGrantsInputSchema = z.object({
  encounterId: z.string().uuid().optional(),
});

export const listSupportGrantsOutputSchema = z.object({
  grants: z.array(supportGrantSchema),
});

// ── Prescriptions (clinical extension, ADR-0010) ───────────────────────
// Doctor-authored clinical records: append-only content, amendments are
// new rows linked by supersedesPrescriptionId (§3.5). Prescription content
// crosses the wire only in these procedure outputs — never in events.

export const PRESCRIPTION_STATUSES = ["active", "superseded", "discontinued"] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export const prescriptionSchema = z.object({
  prescriptionId: z.string(),
  encounterId: z.string(),
  doctorProfileId: z.string(),
  patientProfileId: z.string(),
  medicationName: z.string(),
  dosage: z.string(),
  frequency: z.string(),
  duration: z.string(),
  instructions: z.string().nullable(),
  status: z.enum(PRESCRIPTION_STATUSES),
  /** Null on an original; the superseded revision's id on an amendment. */
  supersedesPrescriptionId: z.string().nullable(),
  issuedAt: z.string(),
  createdAt: z.string(),
});

/** One revision chain, original first, latest revision last. */
export const prescriptionChainSchema = z.object({
  revisions: z.array(prescriptionSchema),
});

const prescriptionContentFields = {
  medicationName: z.string().min(1).max(500),
  dosage: z.string().min(1).max(500),
  frequency: z.string().min(1).max(500),
  duration: z.string().min(1).max(500),
  instructions: z.string().min(1).max(5_000).optional(),
};

export const issuePrescriptionInputSchema = z.object({
  encounterId: z.string().uuid(),
  ...prescriptionContentFields,
});

export const amendPrescriptionInputSchema = z.object({
  /** The ACTIVE revision being corrected — it flips to superseded. */
  prescriptionId: z.string().uuid(),
  ...prescriptionContentFields,
});

export const prescriptionIdInputSchema = z.object({ prescriptionId: z.string().uuid() });

export const prescriptionResultSchema = z.object({
  prescriptionId: z.string(),
  encounterId: z.string(),
  status: z.enum(PRESCRIPTION_STATUSES),
  supersedesPrescriptionId: z.string().nullable(),
});

// ── Patient medical profile (patient-authored, option A — ADR-0010) ────

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

export const medicalProfileSchema = z.object({
  patientProfileId: z.string(),
  bloodType: z.enum(BLOOD_TYPES),
  allergies: z.array(z.string()),
  notes: z.string().nullable(),
  updatedAt: z.string(),
});

export const upsertMedicalProfileInputSchema = z.object({
  bloodType: z.enum(BLOOD_TYPES),
  allergies: z.array(z.string().min(1).max(500)).max(100),
  notes: z.string().min(1).max(10_000).optional(),
});

// ── Patient-reported medications (patient-authored, NOT prescriptions) ─

export const MEDICATION_SOURCES = ["self_prescribed", "over_the_counter"] as const;
export type MedicationSource = (typeof MEDICATION_SOURCES)[number];

export const reportedMedicationSchema = z.object({
  reportedMedicationId: z.string(),
  patientProfileId: z.string(),
  medicationName: z.string(),
  dosage: z.string().nullable(),
  source: z.enum(MEDICATION_SOURCES),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export const addReportedMedicationInputSchema = z.object({
  medicationName: z.string().min(1).max(500),
  dosage: z.string().min(1).max(500).optional(),
  source: z.enum(MEDICATION_SOURCES),
  notes: z.string().min(1).max(5_000).optional(),
});

export const reportedMedicationIdInputSchema = z.object({
  reportedMedicationId: z.string().uuid(),
});

export const removeReportedMedicationResultSchema = z.object({
  reportedMedicationId: z.string(),
  removed: z.boolean(),
});

// ── Clinical history reads (ADR-0010) ──────────────────────────────────
// Prescriptions and patient-reported medications are structurally distinct
// arrays in every payload — never merged into one medication list.

export const patientClinicalHistoryInputSchema = z.object({
  patientProfileId: z.string().uuid(),
});

export const patientClinicalHistoryOutputSchema = z.object({
  patientProfileId: z.string(),
  encounters: z.array(encounterSchema),
  /** Notes grouped per encounter, same shape as encounterNotes. */
  visitNotes: z.array(visitNotesOutputSchema),
  prescriptionChains: z.array(prescriptionChainSchema),
  medicalProfile: medicalProfileSchema.nullable(),
  reportedMedications: z.array(reportedMedicationSchema),
});

/** Patient self-view. Visit notes are deliberately absent (ADR-0010). */
export const myClinicalRecordOutputSchema = z.object({
  patientProfileId: z.string(),
  prescriptionChains: z.array(prescriptionChainSchema),
  medicalProfile: medicalProfileSchema.nullable(),
  reportedMedications: z.array(reportedMedicationSchema),
});
