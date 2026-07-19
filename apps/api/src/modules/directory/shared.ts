/**
 * Directory module internals shared by commands, queries and subscribers.
 */
import { packText } from "@mesomed/contracts/directory";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { Locale } from "@mesomed/contracts/i18n";
import {
  cities,
  categories,
  countries,
  doctorProfiles,
  eq,
  facilities,
  providers,
  type DbExecutor,
} from "@mesomed/db/modules/directory";
import { AppError } from "../../kernel/errors.js";
import type { OutboxEmitter } from "../../kernel/outbox.js";

// Wire-shape helpers live with the LocalizedText contract; re-exported so
// module internals keep one import site.
export { packOptionalText, packText } from "@mesomed/contracts/directory";

/**
 * The locale-specific facility name column driving the stable landing sort
 * (tier_rank, name_<locale>, id) — one partial index exists per locale.
 */
export function facilityNameColumn(locale: Locale) {
  switch (locale) {
    case "en":
      return facilities.nameEn;
    case "ar":
      return facilities.nameAr;
    case "ckb":
      return facilities.nameCkb;
  }
}

export function doctorNameColumn(locale: Locale) {
  switch (locale) {
    case "en":
      return doctorProfiles.nameEn;
    case "ar":
      return doctorProfiles.nameAr;
    case "ckb":
      return doctorProfiles.nameCkb;
  }
}

/** Resolve an active-or-not city row id by slug; NOT_FOUND when absent. */
export async function requireCityId(db: DbExecutor, slug: string): Promise<string> {
  const [row] = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, slug));
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, `Unknown city "${slug}"`);
  return row.id;
}

/**
 * ISO2 of the country a city belongs to, or null for a null/unknown city.
 * Every facility/doctor snapshot event carries it (ADR-0055) so the search
 * read model can scope by country without joining directory tables.
 */
export async function countryIsoForCity(
  db: DbExecutor,
  cityId: string | null,
): Promise<string | null> {
  if (cityId === null) return null;
  const [row] = await db
    .select({ isoCode: countries.isoCode })
    .from(cities)
    .innerJoin(countries, eq(countries.id, cities.countryId))
    .where(eq(cities.id, cityId));
  return row?.isoCode ?? null;
}

export async function requireCategoryId(db: DbExecutor, slug: string): Promise<string> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug));
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, `Unknown category "${slug}"`);
  return row.id;
}

/**
 * Recompute the denormalized public-visibility flag for every listing of a
 * directory provider and emit `directory.*_updated.v1` for each listing
 * whose flag flipped, so downstream read models (search) stay consistent.
 * Runs on the caller's transaction — the emit is atomic with the update.
 *
 * The predicate is intentionally centralized here. Facilities: provider
 * approved AND listing active (Phase 2 gate). Doctors additionally require
 * the billing-subscription mirror (Phase 6) — but only for account-backed
 * profiles: an admin-curated listing (no identityProfileId) has no account
 * to bill and stays visible on approved + active alone. Queries filter on
 * `publicly_visible` and never change.
 */
export function doctorPubliclyVisible(
  provider: { approved: boolean; identityProfileId: string | null; subscriptionActive: boolean },
  active: boolean,
): boolean {
  return (
    provider.approved &&
    active &&
    (provider.identityProfileId === null || provider.subscriptionActive)
  );
}

export async function recomputeProviderVisibility(
  tx: DbExecutor,
  outbox: OutboxEmitter,
  providerId: string,
): Promise<void> {
  const [provider] = await tx
    .select({
      approved: providers.approved,
      identityProfileId: providers.identityProfileId,
      subscriptionActive: providers.subscriptionActive,
    })
    .from(providers)
    .where(eq(providers.id, providerId));
  if (!provider) return;

  const facilityRows = await tx
    .select()
    .from(facilities)
    .where(eq(facilities.providerId, providerId));
  for (const facility of facilityRows) {
    const visible = provider.approved && facility.active;
    if (visible === facility.publiclyVisible) continue;
    await tx
      .update(facilities)
      .set({ publiclyVisible: visible, updatedAt: new Date() })
      .where(eq(facilities.id, facility.id));
    const [category] = await tx
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.id, facility.categoryId));
    const [city] = await tx
      .select({ slug: cities.slug })
      .from(cities)
      .where(eq(cities.id, facility.cityId));
    await outbox.emit(tx, {
      name: "directory.facility_updated.v1",
      aggregateType: "facility",
      aggregateId: facility.id,
      payload: {
        facilityId: facility.id,
        slug: facility.slug,
        name: packText(facility.nameEn, facility.nameAr, facility.nameCkb),
        categorySlug: category?.slug ?? "",
        citySlug: city?.slug ?? "",
        countryIso: await countryIsoForCity(tx, facility.cityId),
        tierRank: facility.tierRank,
        publiclyVisible: visible,
      },
    });
  }

  const doctorRows = await tx
    .select()
    .from(doctorProfiles)
    .where(eq(doctorProfiles.providerId, providerId));
  for (const doctor of doctorRows) {
    const visible = doctorPubliclyVisible(provider, doctor.active);
    if (visible === doctor.publiclyVisible) continue;
    await tx
      .update(doctorProfiles)
      .set({ publiclyVisible: visible, updatedAt: new Date() })
      .where(eq(doctorProfiles.id, doctor.id));
    let citySlug: string | null = null;
    if (doctor.cityId) {
      const [city] = await tx
        .select({ slug: cities.slug })
        .from(cities)
        .where(eq(cities.id, doctor.cityId));
      citySlug = city?.slug ?? null;
    }
    await outbox.emit(tx, {
      name: "directory.doctor_profile_updated.v1",
      aggregateType: "doctor_profile",
      aggregateId: doctor.id,
      payload: {
        doctorProfileId: doctor.id,
        slug: doctor.slug,
        name: packText(doctor.nameEn, doctor.nameAr, doctor.nameCkb),
        specialtyKey: doctor.specialtyKey,
        citySlug,
        countryIso: await countryIsoForCity(tx, doctor.cityId),
        publiclyVisible: visible,
      },
    });
  }
}
