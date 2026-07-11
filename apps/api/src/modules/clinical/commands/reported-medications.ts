/**
 * Patient-reported medications commands (clinical extension, ADR-0010).
 * Patient-authored and structurally distinct from clinical prescriptions;
 * NOT clinical records — hard delete is acceptable, no events, no audit.
 *
 * Layer b (§3.6): rows are created under the SESSION's claimed patient
 * profile and removable only by it.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import { and, eq, patientReportedMedications, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { Session } from "../../../kernel/context.js";
import { requirePatientProfileId } from "../shared.js";

export interface ReportedMedicationResult {
  reportedMedicationId: string;
  patientProfileId: string;
  medicationName: string;
  dosage: string | null;
  source: (typeof patientReportedMedications.source.enumValues)[number];
  notes: string | null;
  createdAt: string;
}

export async function addReportedMedication(
  tx: DbTransaction,
  session: Session,
  input: {
    medicationName: string;
    dosage?: string;
    source: (typeof patientReportedMedications.source.enumValues)[number];
    notes?: string;
  },
): Promise<ReportedMedicationResult> {
  const patientProfileId = await requirePatientProfileId(tx, session);

  const [row] = await tx
    .insert(patientReportedMedications)
    .values({
      patientProfileId,
      medicationName: input.medicationName,
      dosage: input.dosage ?? null,
      source: input.source,
      notes: input.notes ?? null,
    })
    .returning();

  return {
    reportedMedicationId: row!.id,
    patientProfileId,
    medicationName: row!.medicationName,
    dosage: row!.dosage,
    source: row!.source,
    notes: row!.notes,
    createdAt: row!.createdAt.toISOString(),
  };
}

export async function removeReportedMedication(
  tx: DbTransaction,
  session: Session,
  input: { reportedMedicationId: string },
): Promise<{ reportedMedicationId: string; removed: boolean }> {
  const patientProfileId = await requirePatientProfileId(tx, session);

  // Ownership is part of the WHERE clause: another patient's row is
  // indistinguishable from a missing one (no existence oracle).
  const removed = await tx
    .delete(patientReportedMedications)
    .where(
      and(
        eq(patientReportedMedications.id, input.reportedMedicationId),
        eq(patientReportedMedications.patientProfileId, patientProfileId),
      ),
    )
    .returning({ id: patientReportedMedications.id });

  if (removed.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, "Reported medication not found");
  }
  return { reportedMedicationId: input.reportedMedicationId, removed: true };
}
