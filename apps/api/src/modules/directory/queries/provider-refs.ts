/**
 * Published provider lookups for the Phase 6b billing module (§3.1):
 * billing keys charges and revenue-model config on the directory's
 * `providers.id` and snapshots the provider type as its billing category —
 * always through these functions, never a cross-module join.
 */
import { cities, countries, doctorProfiles, eq, providers, type DbExecutor } from "@mesomed/db";
import { getProviderProfileIdForUser } from "../../identity/queries/user-profiles.js";

export interface ProviderRef {
  providerId: string;
  /** The directory provider type — billing's rate category vocabulary. */
  providerType: string;
}

/** The provider's identity/type by directory provider id, or null. */
export async function getProviderRef(
  db: DbExecutor,
  providerId: string,
): Promise<ProviderRef | null> {
  const [row] = await db
    .select({ providerId: providers.id, providerType: providers.providerType })
    .from(providers)
    .where(eq(providers.id, providerId))
    .limit(1);
  return row ?? null;
}

/**
 * The directory provider owned by this identity user, or null. Chain:
 * identity user → provider profile (identity, published) → directory
 * provider (identityProfileId). Backs §3.6 layer-b ownership checks on
 * provider-facing billing procedures.
 */
export async function getProviderRefForUser(
  db: DbExecutor,
  userId: string,
): Promise<ProviderRef | null> {
  const identityProfileId = await getProviderProfileIdForUser(db, userId);
  if (identityProfileId === null) return null;
  const [row] = await db
    .select({ providerId: providers.id, providerType: providers.providerType })
    .from(providers)
    .where(eq(providers.identityProfileId, identityProfileId))
    .limit(1);
  return row ?? null;
}

export interface DoctorProviderRef extends ProviderRef {
  /** ISO 3166-1 alpha-2 of the doctor's city, when one is set. */
  countryCode: string | null;
}

/**
 * The provider (and its country, for payment routing) behind a doctor
 * profile — how billing's booking-event subscribers map an appointment's
 * `doctorProfileId` onto the provider being billed.
 */
export async function getProviderRefForDoctorProfile(
  db: DbExecutor,
  doctorProfileId: string,
): Promise<DoctorProviderRef | null> {
  const [row] = await db
    .select({
      providerId: providers.id,
      providerType: providers.providerType,
      countryCode: countries.isoCode,
    })
    .from(doctorProfiles)
    .innerJoin(providers, eq(providers.id, doctorProfiles.providerId))
    .leftJoin(cities, eq(cities.id, doctorProfiles.cityId))
    .leftJoin(countries, eq(countries.id, cities.countryId))
    .where(eq(doctorProfiles.id, doctorProfileId))
    .limit(1);
  return row ?? null;
}
