/**
 * Published doctor-profile lookups for the Phase 4 scheduling/booking
 * modules (§3.1): existence for referential validation, and the
 * session-user → doctor-profile resolution behind doctor ownership checks
 * (§3.6 layer b). Composes the identity module's published lookup — never
 * a cross-module join.
 */
import { doctorProfiles, eq, providers, type DbExecutor } from "@mesomed/db/modules/directory";
import { getProviderProfileIdForUser } from "../../identity/queries/user-profiles.js";

/** True when the directory owns a doctor profile with this id. */
export async function doctorProfileExists(
  db: DbExecutor,
  doctorProfileId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: doctorProfiles.id })
    .from(doctorProfiles)
    .where(eq(doctorProfiles.id, doctorProfileId))
    .limit(1);
  return row !== undefined;
}

/**
 * The doctor profile belonging to this identity user, or null. Chain:
 * identity user → provider profile (identity, published) → directory
 * provider (identityProfileId) → doctor profile.
 */
export async function getDoctorProfileIdForUser(
  db: DbExecutor,
  userId: string,
): Promise<string | null> {
  const identityProfileId = await getProviderProfileIdForUser(db, userId);
  if (identityProfileId === null) return null;
  const [row] = await db
    .select({ doctorProfileId: doctorProfiles.id })
    .from(providers)
    .innerJoin(doctorProfiles, eq(doctorProfiles.providerId, providers.id))
    .where(eq(providers.identityProfileId, identityProfileId))
    .limit(1);
  return row?.doctorProfileId ?? null;
}
