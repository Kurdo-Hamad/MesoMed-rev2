/**
 * Published visibility queries (MM-DEC rev02 §3): a provider listing is
 * public only when status = approved. The Phase 3 directory module reads
 * through these functions — never by joining identity tables directly
 * (convention #1).
 */
import { and, eq, providerProfiles, type Db } from "@mesomed/db";

export interface ApprovedProvider {
  providerProfileId: string;
  userId: string;
  providerType: string;
}

export async function listApprovedProviders(db: Db): Promise<ApprovedProvider[]> {
  const rows = await db
    .select({
      providerProfileId: providerProfiles.id,
      userId: providerProfiles.userId,
      providerType: providerProfiles.providerType,
    })
    .from(providerProfiles)
    .where(eq(providerProfiles.status, "approved"));
  return rows;
}

export async function isProviderPubliclyVisible(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: providerProfiles.id })
    .from(providerProfiles)
    .where(and(eq(providerProfiles.userId, userId), eq(providerProfiles.status, "approved")))
    .limit(1);
  return row !== undefined;
}
