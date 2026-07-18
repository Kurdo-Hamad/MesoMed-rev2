/**
 * Self-service account deletion (MM-QA-004 F-02) — the in-app erasure the
 * app stores require. Executes the retention-erasure runbook's matrix
 * (docs/runbooks/data-retention-erasure.md §1) for the authenticated
 * caller:
 *
 *  - patient_profiles (identity-owned): anonymized in place — the PII is
 *    nulled/tombstoned but the row and its id survive, so the clinical
 *    record and appointments that reference it stay referentially intact
 *    (the "clinical hold" is structural: this flow never deletes clinical
 *    rows and never drops the profile id, so no runtime hold check is
 *    needed).
 *  - Better Auth user + sessions: deleted through the Better Auth API,
 *    which cascades session/account/user_roles/device_tokens/
 *    user_channel_preferences/provider_profiles at the DB (their FKs are
 *    ON DELETE CASCADE; patient_profiles.user_id is ON DELETE SET NULL and
 *    we already nulled it).
 *  - notification_log (communication-owned): pruned by the communication
 *    subscriber to the id-only `identity.account_deleted.v2` event
 *    (convention #1 — identity never writes another module's tables).
 *  - directory listing (directory-owned): the CASCADE that removes
 *    provider_profiles emits no event, so the event carries the caller's
 *    provider-profile id (when one exists) and the directory subscriber
 *    retires the public listing (ADR-0038, F-02 close-out).
 *
 * Ordering: the identity transaction (anonymize + emit) commits first,
 * then the Better Auth user is deleted. If the delete fails after the
 * commit the caller still holds a session and can retry — anonymize is
 * idempotent and re-emitting only re-runs an idempotent prune.
 */
import { sql } from "drizzle-orm";
import { eq, patientProfiles, providerProfiles, type Db } from "@mesomed/db/modules/identity";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import type { IdentityAuth } from "../auth.js";

export async function deleteAccount(
  deps: { db: Db; outbox: OutboxEmitter; auth: IdentityAuth },
  input: { userId: string },
): Promise<{ deleted: boolean }> {
  await deps.db.transaction(async (tx) => {
    const [profile] = await tx
      .update(patientProfiles)
      .set({
        // "NULL name/phone" (runbook §1) under NOT NULL columns: an empty
        // name and a per-row tombstone phone that can never collide with or
        // be re-claimed as a real normalized (E.164, "+"-prefixed) number.
        fullName: "",
        normalizedPhone: sql`concat('deleted:', ${patientProfiles.id}::text)`,
        email: null,
        dateOfBirth: null,
        gender: null,
        userId: null,
      })
      .where(eq(patientProfiles.userId, input.userId))
      .returning({ id: patientProfiles.id });

    // Read before the post-commit Better Auth delete cascades the row away;
    // provider_profiles is identity-owned, so this is an in-module read.
    const [providerProfile] = await tx
      .select({ id: providerProfiles.id })
      .from(providerProfiles)
      .where(eq(providerProfiles.userId, input.userId));

    await deps.outbox.emit(tx, {
      name: "identity.account_deleted.v2",
      aggregateType: "user",
      aggregateId: input.userId,
      payload: {
        userId: input.userId,
        patientProfileId: profile?.id ?? null,
        providerProfileId: providerProfile?.id ?? null,
      },
    });
  });

  const authContext = await deps.auth.$context;
  await authContext.internalAdapter.deleteUser(input.userId);
  await authContext.internalAdapter.deleteUserSessions(input.userId);

  return { deleted: true };
}
