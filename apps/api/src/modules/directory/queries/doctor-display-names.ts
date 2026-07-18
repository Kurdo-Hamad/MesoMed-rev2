/**
 * Published doctor display-name lookup for the Phase 7 communication
 * module (§3.1): notification templates render the doctor's trilingual
 * name, never joined from another module's tables directly.
 */
import { doctorProfiles, eq, providers, type DbExecutor } from "@mesomed/db/modules/directory";

export interface DoctorDisplayName {
  nameEn: string;
  nameAr: string;
  nameCkb: string;
}

export async function getDoctorDisplayName(
  db: DbExecutor,
  doctorProfileId: string,
): Promise<DoctorDisplayName | null> {
  const [row] = await db
    .select({
      nameEn: doctorProfiles.nameEn,
      nameAr: doctorProfiles.nameAr,
      nameCkb: doctorProfiles.nameCkb,
    })
    .from(doctorProfiles)
    .where(eq(doctorProfiles.id, doctorProfileId))
    .limit(1);
  return row ?? null;
}

/**
 * The identity provider-profile id behind a directory doctor profile, or
 * null. Chain: doctor profile → directory provider → `identityProfileId`
 * (cross-module reference to identity's `providerProfiles.id`). Backs
 * billing subscription-notification lookups that need the provider's
 * account contact.
 */
export async function getIdentityProviderProfileIdForDoctorProfile(
  db: DbExecutor,
  doctorProfileId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ identityProfileId: providers.identityProfileId })
    .from(doctorProfiles)
    .innerJoin(providers, eq(providers.id, doctorProfiles.providerId))
    .where(eq(doctorProfiles.id, doctorProfileId))
    .limit(1);
  return row?.identityProfileId ?? null;
}
