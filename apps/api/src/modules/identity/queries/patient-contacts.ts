/**
 * Published patient-contact lookup for the Phase 7 communication module
 * (§3.1): subscribers and the sender re-read current contact PII through
 * this function — the event payload itself carries only the patient
 * profile id.
 */
import { eq, patientProfiles, type DbExecutor } from "@mesomed/db";

export interface PatientContact {
  userId: string | null;
  normalizedPhone: string;
  fullName: string;
  email: string | null;
}

export async function getPatientContact(
  db: DbExecutor,
  patientProfileId: string,
): Promise<PatientContact | null> {
  const [row] = await db
    .select({
      userId: patientProfiles.userId,
      normalizedPhone: patientProfiles.normalizedPhone,
      fullName: patientProfiles.fullName,
      email: patientProfiles.email,
    })
    .from(patientProfiles)
    .where(eq(patientProfiles.id, patientProfileId))
    .limit(1);
  return row ?? null;
}
