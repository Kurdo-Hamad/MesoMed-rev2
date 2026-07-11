/**
 * Public facility detail (MM-PLAN-001 §5 Phase 3): full trilingual detail
 * with media (capped server-side by the effective tier's gallery limit)
 * and sections labelled through the section-type vocabulary.
 */
import type { z } from "zod";
import type { facilityDetailOutputSchema } from "@mesomed/contracts/directory";
import { effectiveTierRank, galleryCapForRank } from "@mesomed/domain/billing";
import {
  and,
  asc,
  categories,
  cities,
  eq,
  facilities,
  facilityMedia,
  facilitySectionTypes,
  facilitySections,
  or,
  type Db,
} from "@mesomed/db";
import { packOptionalText, packText } from "../shared.js";

export type FacilityDetail = z.output<typeof facilityDetailOutputSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getFacilityDetail(db: Db, slugOrId: string): Promise<FacilityDetail | null> {
  const identityMatch = UUID_RE.test(slugOrId)
    ? or(eq(facilities.slug, slugOrId), eq(facilities.id, slugOrId))
    : eq(facilities.slug, slugOrId);

  const [row] = await db
    .select({
      facility: facilities,
      categorySlug: categories.slug,
      categoryNameEn: categories.nameEn,
      categoryNameAr: categories.nameAr,
      categoryNameCkb: categories.nameCkb,
      citySlug: cities.slug,
      cityNameEn: cities.nameEn,
      cityNameAr: cities.nameAr,
      cityNameCkb: cities.nameCkb,
    })
    .from(facilities)
    .innerJoin(categories, eq(categories.id, facilities.categoryId))
    .innerJoin(cities, eq(cities.id, facilities.cityId))
    .where(and(identityMatch, eq(facilities.publiclyVisible, true)))
    .limit(1);
  if (!row) return null;

  const facility = row.facility;
  const rank = effectiveTierRank(facility.tierRank, facility.tierExpiresAt);
  // Server-side gallery cap: media beyond the effective tier's limit is
  // never returned, regardless of what was uploaded.
  const media = await db
    .select({ path: facilityMedia.storagePath, alt: facilityMedia.altText })
    .from(facilityMedia)
    .where(eq(facilityMedia.facilityId, facility.id))
    .orderBy(asc(facilityMedia.sortOrder), asc(facilityMedia.id))
    .limit(galleryCapForRank(rank));

  const sections = await db
    .select({
      id: facilitySections.id,
      sectionTypeKey: facilitySectionTypes.key,
      labelEn: facilitySectionTypes.labelEn,
      labelAr: facilitySectionTypes.labelAr,
      labelCkb: facilitySectionTypes.labelCkb,
      nameEn: facilitySections.nameEn,
      nameAr: facilitySections.nameAr,
      nameCkb: facilitySections.nameCkb,
      imagePath: facilitySections.imagePath,
    })
    .from(facilitySections)
    .innerJoin(facilitySectionTypes, eq(facilitySectionTypes.id, facilitySections.sectionTypeId))
    .where(and(eq(facilitySections.facilityId, facility.id), eq(facilitySections.active, true)))
    .orderBy(
      asc(facilitySectionTypes.displayOrder),
      asc(facilitySections.sortOrder),
      asc(facilitySections.id),
    );

  return {
    id: facility.id,
    slug: facility.slug,
    name: packText(facility.nameEn, facility.nameAr, facility.nameCkb),
    categorySlug: row.categorySlug,
    categoryName: packText(row.categoryNameEn, row.categoryNameAr, row.categoryNameCkb),
    citySlug: row.citySlug,
    cityName: packText(row.cityNameEn, row.cityNameAr, row.cityNameCkb),
    address: packOptionalText(facility.addressEn, facility.addressAr, facility.addressCkb),
    phone: facility.phone,
    email: facility.email,
    websiteOrSocial: facility.websiteOrSocial,
    about: packOptionalText(facility.aboutEn, facility.aboutAr, facility.aboutCkb),
    whyChooseUs: packOptionalText(
      facility.whyChooseUsEn,
      facility.whyChooseUsAr,
      facility.whyChooseUsCkb,
    ),
    tierRank: rank,
    featured: rank === 1,
    media: media.map((item) => ({ path: item.path, alt: item.alt })),
    sections: sections.map((section) => ({
      id: section.id,
      sectionTypeKey: section.sectionTypeKey,
      sectionTypeLabel: packText(section.labelEn, section.labelAr, section.labelCkb),
      name: packText(section.nameEn, section.nameAr, section.nameCkb),
      imagePath: section.imagePath,
    })),
  };
}
