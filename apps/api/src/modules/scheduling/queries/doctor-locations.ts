/**
 * Public doctor-locations read: where a doctor practises — the client
 * picks one before asking booking for that week's availability.
 */
import { packOptionalText, packText } from "@mesomed/contracts/directory";
import type { z } from "zod";
import type { listDoctorLocationsOutputSchema } from "@mesomed/contracts/scheduling";
import {
  and,
  doctorLocations,
  eq,
  practiceLocations,
  type DbExecutor,
} from "@mesomed/db/modules/scheduling";

export type ListDoctorLocationsOutput = z.output<typeof listDoctorLocationsOutputSchema>;

export async function listDoctorLocations(
  db: DbExecutor,
  doctorProfileId: string,
): Promise<ListDoctorLocationsOutput> {
  const rows = await db
    .select({
      doctorLocationId: doctorLocations.id,
      locationId: practiceLocations.id,
      slug: practiceLocations.slug,
      nameEn: practiceLocations.nameEn,
      nameAr: practiceLocations.nameAr,
      nameCkb: practiceLocations.nameCkb,
      addressEn: practiceLocations.addressEn,
      addressAr: practiceLocations.addressAr,
      addressCkb: practiceLocations.addressCkb,
      phone: practiceLocations.phone,
      timeZone: practiceLocations.timeZone,
      active: doctorLocations.active,
      locationActive: practiceLocations.active,
    })
    .from(doctorLocations)
    .innerJoin(practiceLocations, eq(practiceLocations.id, doctorLocations.locationId))
    .where(
      and(eq(doctorLocations.doctorProfileId, doctorProfileId), eq(doctorLocations.active, true)),
    )
    .orderBy(practiceLocations.slug);

  return {
    locations: rows
      .filter((row) => row.locationActive)
      .map((row) => ({
        doctorLocationId: row.doctorLocationId,
        locationId: row.locationId,
        slug: row.slug,
        name: packText(row.nameEn, row.nameAr, row.nameCkb),
        address: packOptionalText(row.addressEn, row.addressAr, row.addressCkb),
        phone: row.phone,
        timeZone: row.timeZone,
        active: row.active,
      })),
  };
}
