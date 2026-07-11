/**
 * Patient medical profile command (clinical extension, ADR-0010, option A
 * — locked): free upsert by the owning patient, no revision history.
 * Patient-owned safety data the patient has no incentive to falsify;
 * deliberately outside the RLS/audit clinical tier.
 *
 * Layer b (§3.6): the row is keyed by the SESSION's claimed patient
 * profile — a patient cannot address another patient's row at all. No
 * events (no consumer exists; additive later per §3.3).
 */
import { sql, patientMedicalProfiles, type DbTransaction } from "@mesomed/db";
import type { Session } from "../../../kernel/context.js";
import { requirePatientProfileId } from "../shared.js";

export interface MedicalProfileResult {
  patientProfileId: string;
  bloodType: (typeof patientMedicalProfiles.bloodType.enumValues)[number];
  allergies: string[];
  notes: string | null;
  updatedAt: string;
}

export async function upsertMedicalProfile(
  tx: DbTransaction,
  session: Session,
  input: {
    bloodType: (typeof patientMedicalProfiles.bloodType.enumValues)[number];
    allergies: string[];
    notes?: string;
  },
): Promise<MedicalProfileResult> {
  const patientProfileId = await requirePatientProfileId(tx, session);

  const [row] = await tx
    .insert(patientMedicalProfiles)
    .values({
      patientProfileId,
      bloodType: input.bloodType,
      allergies: input.allergies,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: patientMedicalProfiles.patientProfileId,
      set: {
        bloodType: input.bloodType,
        allergies: input.allergies,
        notes: input.notes ?? null,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return {
    patientProfileId,
    bloodType: row!.bloodType,
    allergies: row!.allergies,
    notes: row!.notes,
    updatedAt: row!.updatedAt.toISOString(),
  };
}
