/**
 * Published doctor-location lookup for the clinical module's
 * continuity-of-care check (§3.1, ADR-0010). Deliberately unfiltered by
 * `active`: a treating relationship established through a location the
 * doctor has since left still counts.
 */
import { doctorLocations, eq, type DbExecutor } from "@mesomed/db/modules/scheduling";

export async function getDoctorLocationIdsForDoctorProfile(
  db: DbExecutor,
  doctorProfileId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: doctorLocations.id })
    .from(doctorLocations)
    .where(eq(doctorLocations.doctorProfileId, doctorProfileId));
  return rows.map((row) => row.id);
}
