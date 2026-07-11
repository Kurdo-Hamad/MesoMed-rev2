/**
 * Published provider-contact lookup for the Phase 7 communication module
 * (§3.1): billing subscription notifications resolve the provider's
 * account email through this function, keyed on the identity provider
 * profile id (directory's `providers.identityProfileId` — a cross-module
 * reference, resolved via directory's own published query first).
 */
import { eq, providerProfiles, user, type DbExecutor } from "@mesomed/db";

export interface ProviderContact {
  userId: string;
  email: string;
  phone: string;
}

export async function getProviderContact(
  db: DbExecutor,
  providerProfileId: string,
): Promise<ProviderContact | null> {
  const [row] = await db
    .select({ userId: providerProfiles.userId, email: user.email, phone: providerProfiles.phone })
    .from(providerProfiles)
    .innerJoin(user, eq(user.id, providerProfiles.userId))
    .where(eq(providerProfiles.id, providerProfileId))
    .limit(1);
  return row ?? null;
}
