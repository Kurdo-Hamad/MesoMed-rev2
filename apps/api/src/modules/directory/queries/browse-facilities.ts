/**
 * Public facility browse (MM-PLAN-001 §5 Phase 3): keyset-only pagination
 * on the stable landing sort (tier_rank, name_<locale>, id) through the
 * ported opaque cursor — no OFFSET anywhere; a malformed cursor serves
 * page one, never an error. Name search lives in the search module.
 */
import type { z } from "zod";
import type { browseFacilitiesInputSchema, facilityCardSchema } from "@mesomed/contracts/directory";
import type { Locale } from "@mesomed/contracts/i18n";
import { decodeFacilityCursor, encodeFacilityCursor } from "@mesomed/domain/directory";
import { effectiveTierRank } from "@mesomed/domain/billing";
import {
  and,
  asc,
  cities,
  eq,
  facilities,
  sql,
  type Db,
  type SQL,
} from "@mesomed/db/modules/directory";
import { facilityNameColumn, packText } from "../shared.js";

export type BrowseFacilitiesInput = z.output<typeof browseFacilitiesInputSchema>;
export type FacilityCard = z.output<typeof facilityCardSchema>;

export async function browseFacilities(
  db: Db,
  locale: Locale,
  country: string,
  input: BrowseFacilitiesInput,
): Promise<{ items: FacilityCard[]; nextCursor: string | null }> {
  const nameCol = facilityNameColumn(locale);
  const cursor = decodeFacilityCursor(input.cursor);

  const conditions: SQL[] = [
    eq(facilities.publiclyVisible, true),
    sql`${facilities.categoryId} = (select id from categories where slug = ${input.categorySlug})`,
    // Country scoping (ADR-0055): browse serves the request country only;
    // detail procedures stay unscoped so direct links keep working.
    sql`${facilities.cityId} in (
      select c.id from cities c join countries co on co.id = c.country_id
      where co.iso_code = ${country}
    )`,
  ];
  if (input.citySlug) {
    conditions.push(
      sql`${facilities.cityId} = (select id from cities where slug = ${input.citySlug})`,
    );
  }
  if (cursor) {
    // Row-value keyset continuation keeps the predicate index-servable.
    conditions.push(
      sql`(${facilities.tierRank}, ${nameCol}, ${facilities.id}) > (${cursor.r}, ${cursor.n}, ${cursor.i}::uuid)`,
    );
  }

  const rows = await db
    .select({
      id: facilities.id,
      slug: facilities.slug,
      nameEn: facilities.nameEn,
      nameAr: facilities.nameAr,
      nameCkb: facilities.nameCkb,
      sortName: nameCol,
      tierRank: facilities.tierRank,
      tierExpiresAt: facilities.tierExpiresAt,
      citySlug: cities.slug,
      cityNameEn: cities.nameEn,
      cityNameAr: cities.nameAr,
      cityNameCkb: cities.nameCkb,
      photoPath: sql<string | null>`(
        select m.storage_path from facility_media m
        where m.facility_id = ${facilities.id}
        order by m.sort_order, m.id limit 1
      )`.as("photo_path"),
    })
    .from(facilities)
    .innerJoin(cities, eq(cities.id, facilities.cityId))
    .where(and(...conditions))
    .orderBy(asc(facilities.tierRank), asc(nameCol), asc(facilities.id))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const hasMore = rows.length > input.limit;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => {
      const rank = effectiveTierRank(row.tierRank, row.tierExpiresAt);
      return {
        id: row.id,
        slug: row.slug,
        name: packText(row.nameEn, row.nameAr, row.nameCkb),
        citySlug: row.citySlug,
        cityName: packText(row.cityNameEn, row.cityNameAr, row.cityNameCkb),
        tierRank: rank,
        featured: rank === 1,
        photoPath: row.photoPath,
      };
    }),
    nextCursor:
      hasMore && last
        ? encodeFacilityCursor({ r: last.tierRank, n: last.sortName, i: last.id })
        : null,
  };
}
