/**
 * Homepage feed (MM-PLAN-001 §5 Phase 3): the featured-slot/promotions
 * resolver the old app stubbed, implemented properly.
 *
 * Slot order: curated homepage_promotions first (active, inside their
 * schedule window, city-matched, curation order), resolved to live cards —
 * a promotion whose listing vanished or lost public visibility is silently
 * dropped, never an error. Remaining slots are filled with effective
 * tier-1 ("featured") facilities not already present, in the stable
 * landing order.
 */
import type { z } from "zod";
import type {
  homepageFeedInputSchema,
  homepageFeedOutputSchema,
} from "@mesomed/contracts/directory";
import type { Locale } from "@mesomed/contracts/i18n";
import { effectiveTierRank } from "@mesomed/domain/billing";
import {
  and,
  asc,
  categories,
  cities,
  eq,
  facilities,
  gte,
  homepagePromotions,
  isNull,
  or,
  sql,
  type Db,
  type SQL,
} from "@mesomed/db/modules/directory";
import { facilityNameColumn, packText } from "../shared.js";
import { getDoctorDetail } from "./doctor-detail.js";
import type { FacilityCard } from "./browse-facilities.js";

export type HomepageFeedInput = z.output<typeof homepageFeedInputSchema>;
export type HomepageFeed = z.output<typeof homepageFeedOutputSchema>;

type HomepageSlot = HomepageFeed["slots"][number];

export async function getHomepageFeed(
  db: Db,
  locale: Locale,
  input: HomepageFeedInput,
): Promise<HomepageFeed> {
  const now = new Date();
  const promotionConditions: SQL[] = [
    eq(homepagePromotions.active, true),
    or(isNull(homepagePromotions.promotedUntil), gte(homepagePromotions.promotedUntil, now))!,
  ];
  if (input.citySlug) {
    promotionConditions.push(
      sql`${homepagePromotions.cityId} = (select id from cities where slug = ${input.citySlug})`,
    );
  }

  const promotionRows = await db
    .select({
      entityType: homepagePromotions.entityType,
      categorySlug: homepagePromotions.categorySlug,
      entityRef: homepagePromotions.entityRef,
    })
    .from(homepagePromotions)
    .where(and(...promotionConditions))
    .orderBy(asc(homepagePromotions.sortOrder), asc(homepagePromotions.id))
    .limit(input.limit);

  const slots: HomepageSlot[] = [];
  const seenFacilityIds = new Set<string>();

  for (const promotion of promotionRows) {
    if (slots.length >= input.limit) break;
    if (promotion.entityType === "facility") {
      const card = await facilityCardBySlug(db, promotion.entityRef);
      if (!card) continue;
      seenFacilityIds.add(card.id);
      slots.push({
        kind: "facility",
        categorySlug: promotion.categorySlug,
        promoted: true,
        facility: card,
      });
    } else {
      // Doctor detail already enforces public visibility and carries every
      // card field — resolve the promoted slug through it.
      const detail = await getDoctorDetail(db, promotion.entityRef);
      if (!detail) continue;
      slots.push({
        kind: "doctor",
        categorySlug: promotion.categorySlug,
        promoted: true,
        doctor: {
          id: detail.id,
          slug: detail.slug,
          name: detail.name,
          specialtyKey: detail.specialtyKey,
          specialtyName: detail.specialtyName,
          citySlug: detail.citySlug,
          cityName: detail.cityName,
          photoUrl: detail.photoUrl,
        },
      });
    }
  }

  // Featured fill: effective tier-1 facilities in landing order, skipping
  // listings already promoted above.
  if (slots.length < input.limit) {
    const nameCol = facilityNameColumn(locale);
    const fillConditions: SQL[] = [
      eq(facilities.publiclyVisible, true),
      eq(facilities.tierRank, 1),
    ];
    if (input.citySlug) {
      fillConditions.push(
        sql`${facilities.cityId} = (select id from cities where slug = ${input.citySlug})`,
      );
    }
    const fillRows = await db
      .select({
        id: facilities.id,
        slug: facilities.slug,
        nameEn: facilities.nameEn,
        nameAr: facilities.nameAr,
        nameCkb: facilities.nameCkb,
        tierRank: facilities.tierRank,
        tierExpiresAt: facilities.tierExpiresAt,
        categorySlug: categories.slug,
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
      .innerJoin(categories, eq(categories.id, facilities.categoryId))
      .innerJoin(cities, eq(cities.id, facilities.cityId))
      .where(and(...fillConditions))
      .orderBy(asc(facilities.tierRank), asc(nameCol), asc(facilities.id))
      .limit(input.limit + seenFacilityIds.size);

    for (const row of fillRows) {
      if (slots.length >= input.limit) break;
      if (seenFacilityIds.has(row.id)) continue;
      const rank = effectiveTierRank(row.tierRank, row.tierExpiresAt);
      // Stored tier 1 but expired: not featured — skip rather than surface
      // a demoted listing in a featured slot.
      if (rank !== 1) continue;
      slots.push({
        kind: "facility",
        categorySlug: row.categorySlug,
        promoted: false,
        facility: {
          id: row.id,
          slug: row.slug,
          name: packText(row.nameEn, row.nameAr, row.nameCkb),
          citySlug: row.citySlug,
          cityName: packText(row.cityNameEn, row.cityNameAr, row.cityNameCkb),
          tierRank: rank,
          featured: true,
          photoPath: row.photoPath,
        },
      });
    }
  }

  return { slots };
}

async function facilityCardBySlug(db: Db, slug: string): Promise<FacilityCard | null> {
  const [row] = await db
    .select({
      id: facilities.id,
      slug: facilities.slug,
      nameEn: facilities.nameEn,
      nameAr: facilities.nameAr,
      nameCkb: facilities.nameCkb,
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
    .where(and(eq(facilities.slug, slug), eq(facilities.publiclyVisible, true)))
    .limit(1);
  if (!row) return null;
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
}
