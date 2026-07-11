/**
 * Published identity lookups for Phase 4 ownership checks (§3.6 layer b).
 * The scheduling/booking modules resolve "who is this session" through
 * these functions — never by joining identity tables directly (§3.1).
 */
import { eq, patientProfiles, providerProfiles, type DbExecutor } from "@mesomed/db";

/** The user's provider profile id, or null when they have none. */
export async function getProviderProfileIdForUser(
  db: DbExecutor,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: providerProfiles.id })
    .from(providerProfiles)
    .where(eq(providerProfiles.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

/** The user's claimed patient profile id, or null when unclaimed/absent. */
export async function getPatientProfileIdForUser(
  db: DbExecutor,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: patientProfiles.id })
    .from(patientProfiles)
    .where(eq(patientProfiles.userId, userId))
    .limit(1);
  return row?.id ?? null;
}
