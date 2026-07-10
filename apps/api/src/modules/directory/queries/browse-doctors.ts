/**
 * Public doctor browse (MM-PLAN-001 §5 Phase 3): keyset pagination on the
 * stable (name_<locale>, id) sort, reusing the ported opaque cursor with a
 * constant rank component (doctors carry no listing tier in Phase 3).
 */
import type { z } from "zod";
import type { browseDoctorsInputSchema, doctorCardSchema } from "@mesomed/contracts/directory";
import type { Locale } from "@mesomed/contracts/i18n";
import { decodeFacilityCursor, encodeFacilityCursor } from "@mesomed/domain/directory";
import {
  and,
  asc,
  cities,
  doctorProfiles,
  eq,
  specialties,
  sql,
  type Db,
  type SQL,
} from "@mesomed/db";
import { doctorNameColumn, packOptionalText, packText } from "../shared.js";

export type BrowseDoctorsInput = z.output<typeof browseDoctorsInputSchema>;
export type DoctorCard = z.output<typeof doctorCardSchema>;

/** Doctors have no tier; the cursor rank component is pinned to 0. */
const DOCTOR_CURSOR_RANK = 0;

export async function browseDoctors(
  db: Db,
  locale: Locale,
  input: BrowseDoctorsInput,
): Promise<{ items: DoctorCard[]; nextCursor: string | null }> {
  const nameCol = doctorNameColumn(locale);
  const cursor = decodeFacilityCursor(input.cursor);

  const conditions: SQL[] = [eq(doctorProfiles.publiclyVisible, true)];
  if (input.specialtyKey) {
    conditions.push(eq(doctorProfiles.specialtyKey, input.specialtyKey));
  }
  if (input.citySlug) {
    conditions.push(
      sql`${doctorProfiles.cityId} = (select id from cities where slug = ${input.citySlug})`,
    );
  }
  if (cursor) {
    conditions.push(sql`(${nameCol}, ${doctorProfiles.id}) > (${cursor.n}, ${cursor.i}::uuid)`);
  }

  const rows = await db
    .select({
      id: doctorProfiles.id,
      slug: doctorProfiles.slug,
      nameEn: doctorProfiles.nameEn,
      nameAr: doctorProfiles.nameAr,
      nameCkb: doctorProfiles.nameCkb,
      sortName: nameCol,
      specialtyKey: doctorProfiles.specialtyKey,
      specialtyNameEn: specialties.nameEn,
      specialtyNameAr: specialties.nameAr,
      specialtyNameCkb: specialties.nameCkb,
      photoUrl: doctorProfiles.photoUrl,
      citySlug: cities.slug,
      cityNameEn: cities.nameEn,
      cityNameAr: cities.nameAr,
      cityNameCkb: cities.nameCkb,
    })
    .from(doctorProfiles)
    .leftJoin(specialties, eq(specialties.key, doctorProfiles.specialtyKey))
    .leftJoin(cities, eq(cities.id, doctorProfiles.cityId))
    .where(and(...conditions))
    .orderBy(asc(nameCol), asc(doctorProfiles.id))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const hasMore = rows.length > input.limit;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: packText(row.nameEn, row.nameAr, row.nameCkb),
      specialtyKey: row.specialtyKey,
      specialtyName:
        row.specialtyNameEn === null
          ? null
          : packText(row.specialtyNameEn, row.specialtyNameAr ?? "", row.specialtyNameCkb ?? ""),
      citySlug: row.citySlug,
      cityName: packOptionalText(row.cityNameEn, row.cityNameAr, row.cityNameCkb),
      photoUrl: row.photoUrl,
    })),
    nextCursor:
      hasMore && last
        ? encodeFacilityCursor({ r: DOCTOR_CURSOR_RANK, n: last.sortName, i: last.id })
        : null,
  };
}
