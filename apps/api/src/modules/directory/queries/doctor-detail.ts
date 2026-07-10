/**
 * Public doctor detail (MM-PLAN-001 §5 Phase 3): trilingual profile joined
 * with its specialty and optional city — publicly visible profiles only.
 */
import type { z } from "zod";
import type { doctorDetailOutputSchema } from "@mesomed/contracts/directory";
import { and, cities, doctorProfiles, eq, or, specialties, type Db } from "@mesomed/db";
import { packOptionalText, packText } from "../shared.js";

export type DoctorDetail = z.output<typeof doctorDetailOutputSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getDoctorDetail(db: Db, slugOrId: string): Promise<DoctorDetail | null> {
  const identityMatch = UUID_RE.test(slugOrId)
    ? or(eq(doctorProfiles.slug, slugOrId), eq(doctorProfiles.id, slugOrId))
    : eq(doctorProfiles.slug, slugOrId);

  const [row] = await db
    .select({
      doctor: doctorProfiles,
      specialtyNameEn: specialties.nameEn,
      specialtyNameAr: specialties.nameAr,
      specialtyNameCkb: specialties.nameCkb,
      citySlug: cities.slug,
      cityNameEn: cities.nameEn,
      cityNameAr: cities.nameAr,
      cityNameCkb: cities.nameCkb,
    })
    .from(doctorProfiles)
    .leftJoin(specialties, eq(specialties.key, doctorProfiles.specialtyKey))
    .leftJoin(cities, eq(cities.id, doctorProfiles.cityId))
    .where(and(identityMatch, eq(doctorProfiles.publiclyVisible, true)))
    .limit(1);
  if (!row) return null;

  const doctor = row.doctor;
  return {
    id: doctor.id,
    slug: doctor.slug,
    name: packText(doctor.nameEn, doctor.nameAr, doctor.nameCkb),
    bio: packOptionalText(doctor.bioEn, doctor.bioAr, doctor.bioCkb),
    specialtyKey: doctor.specialtyKey,
    specialtyName:
      row.specialtyNameEn === null
        ? null
        : packText(row.specialtyNameEn, row.specialtyNameAr ?? "", row.specialtyNameCkb ?? ""),
    citySlug: row.citySlug,
    cityName: packOptionalText(row.cityNameEn, row.cityNameAr, row.cityNameCkb),
    photoUrl: doctor.photoUrl,
  };
}
