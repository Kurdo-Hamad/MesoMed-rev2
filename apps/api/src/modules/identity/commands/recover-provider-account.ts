/**
 * Admin manual provider recovery (MM-DEC rev02 §5): after out-of-band
 * identity verification, an administrator sets a new password and revokes
 * every session. Credentials/sessions are Better Auth state and go through
 * its server context; the audit event is written through the outbox in an
 * identity transaction afterwards — if the event write fails the endpoint
 * fails and the admin retries (the operations are idempotent).
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import { eq, providerProfiles, type Db } from "@mesomed/db/modules/identity";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import type { IdentityAuth } from "../auth.js";

export interface RecoverProviderAccountInput {
  providerProfileId: string;
  newPassword: string;
  reason: string;
  recoveredBy: string;
}

export async function recoverProviderAccount(
  deps: { db: Db; outbox: OutboxEmitter; auth: IdentityAuth },
  input: RecoverProviderAccountInput,
): Promise<{ providerProfileId: string; sessionsRevoked: boolean }> {
  const [profile] = await deps.db
    .select({ id: providerProfiles.id, userId: providerProfiles.userId })
    .from(providerProfiles)
    .where(eq(providerProfiles.id, input.providerProfileId));
  if (!profile) {
    throw new AppError(ErrorCode.NOT_FOUND, "Provider profile not found");
  }

  const authContext = await deps.auth.$context;
  const hashed = await authContext.password.hash(input.newPassword);
  await authContext.internalAdapter.updatePassword(profile.userId, hashed);
  await authContext.internalAdapter.deleteUserSessions(profile.userId);

  await deps.db.transaction(async (tx) => {
    await deps.outbox.emit(tx, {
      name: "identity.provider_recovered.v1",
      aggregateType: "provider_profile",
      aggregateId: profile.id,
      payload: {
        providerProfileId: profile.id,
        userId: profile.userId,
        recoveredBy: input.recoveredBy,
        reason: input.reason,
      },
    });
  });

  return { providerProfileId: profile.id, sessionsRevoked: true };
}
