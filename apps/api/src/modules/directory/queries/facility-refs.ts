/**
 * Published facility lookups for other modules (§3.1) — referential
 * validation only, mirroring `doctor-profile-refs.ts`. Phase 6's billing
 * commands validate payment targets through this, never by joining
 * directory tables.
 */
import { eq, facilities, type DbExecutor } from "@mesomed/db/modules/directory";

/** True when the directory owns a facility with this id. */
export async function facilityExists(db: DbExecutor, facilityId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.id, facilityId))
    .limit(1);
  return row !== undefined;
}
