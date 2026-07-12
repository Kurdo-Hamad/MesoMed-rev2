/**
 * Published location display-name lookup for the Phase 7 communication
 * module (§3.1): notification templates render the practice location's
 * trilingual name from the appointment's `doctorLocationId`.
 */
import { doctorLocations, eq, practiceLocations, type DbExecutor } from "@mesomed/db";

export interface LocationDisplayName {
  /** Directory doctor-profile id practising at this location (cross-module reference, no FK). */
  doctorProfileId: string;
  nameEn: string;
  nameAr: string;
  nameCkb: string;
}

export async function getLocationNameForDoctorLocation(
  db: DbExecutor,
  doctorLocationId: string,
): Promise<LocationDisplayName | null> {
  const [row] = await db
    .select({
      doctorProfileId: doctorLocations.doctorProfileId,
      nameEn: practiceLocations.nameEn,
      nameAr: practiceLocations.nameAr,
      nameCkb: practiceLocations.nameCkb,
    })
    .from(doctorLocations)
    .innerJoin(practiceLocations, eq(practiceLocations.id, doctorLocations.locationId))
    .where(eq(doctorLocations.id, doctorLocationId))
    .limit(1);
  return row ?? null;
}
