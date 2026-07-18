/**
 * Creates the pending provider profile after Better Auth signup
 * (MM-DEC rev02 §3): account exists immediately with status = pending,
 * login-capable, not publicly listed. Requires a verified email — the
 * provider registration contract — so a placeholder-email patient account
 * can never turn itself into a provider.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import type { ProviderType } from "@mesomed/contracts/identity";
import { normalizePhone } from "@mesomed/domain/identity";
import {
  eq,
  providerProfiles,
  user,
  userRoles,
  type DbTransaction,
} from "@mesomed/db/modules/identity";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";

export interface CompleteProviderSignupInput {
  userId: string;
  providerType: ProviderType;
  phone: string;
}

export async function completeProviderSignup(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: CompleteProviderSignupInput,
): Promise<{ providerProfileId: string; status: "pending" | "approved" | "rejected" }> {
  const normalized = normalizePhone(input.phone);
  if (normalized === null) {
    throw new AppError(ErrorCode.VALIDATION, "Invalid phone number");
  }

  const [account] = await tx.select().from(user).where(eq(user.id, input.userId));
  if (!account) {
    throw new AppError(ErrorCode.NOT_FOUND, "User not found");
  }
  if (!account.emailVerified) {
    throw new AppError(ErrorCode.EMAIL_NOT_VERIFIED, "Provider accounts require a verified email");
  }

  // Idempotent: a provider completing signup twice keeps one profile.
  const [existing] = await tx
    .select({ id: providerProfiles.id, status: providerProfiles.status })
    .from(providerProfiles)
    .where(eq(providerProfiles.userId, input.userId));
  if (existing) {
    return { providerProfileId: existing.id, status: existing.status };
  }

  const [created] = await tx
    .insert(providerProfiles)
    .values({ userId: input.userId, providerType: input.providerType, phone: normalized })
    .returning({ id: providerProfiles.id, status: providerProfiles.status });
  if (!created) {
    throw new AppError(ErrorCode.INTERNAL, "Failed to create provider profile");
  }

  await tx.insert(userRoles).values({ userId: input.userId, role: "doctor" }).onConflictDoNothing();

  await outbox.emit(tx, {
    name: "identity.user_registered.v2",
    aggregateType: "user",
    aggregateId: input.userId,
    payload: { userId: input.userId, userType: "provider" },
  });
  await outbox.emit(tx, {
    name: "identity.role_assigned.v1",
    aggregateType: "user",
    aggregateId: input.userId,
    payload: { userId: input.userId, role: "doctor" },
  });

  return { providerProfileId: created.id, status: created.status };
}
