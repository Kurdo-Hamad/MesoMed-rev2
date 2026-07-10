/**
 * Admin verification decision (MM-DEC rev02 §3): pending → approved or
 * rejected; approved ⇄ rejected for later revocation/appeal. The provider
 * is notified on change — notification dispatch is Phase 7, so this phase
 * emits identity.provider_status_changed.v1 for it to consume.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import { eq, providerProfiles, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";

export interface SetProviderStatusInput {
  providerProfileId: string;
  status: "approved" | "rejected";
  reason?: string;
  changedBy: string;
}

export async function setProviderStatus(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: SetProviderStatusInput,
): Promise<{ providerProfileId: string; status: "pending" | "approved" | "rejected" }> {
  const [profile] = await tx
    .select({ id: providerProfiles.id, userId: providerProfiles.userId, status: providerProfiles.status })
    .from(providerProfiles)
    .where(eq(providerProfiles.id, input.providerProfileId))
    .for("update");
  if (!profile) {
    throw new AppError(ErrorCode.NOT_FOUND, "Provider profile not found");
  }
  if (profile.status === input.status) {
    throw new AppError(
      ErrorCode.INVALID_STATUS_TRANSITION,
      `Provider is already ${input.status}`,
    );
  }

  const [updated] = await tx
    .update(providerProfiles)
    .set({
      status: input.status,
      statusChangedAt: new Date(),
      statusChangedBy: input.changedBy,
      rejectionReason: input.status === "rejected" ? (input.reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(providerProfiles.id, profile.id))
    .returning({ id: providerProfiles.id, status: providerProfiles.status });

  await outbox.emit(tx, {
    name: "identity.provider_status_changed.v1",
    aggregateType: "provider_profile",
    aggregateId: profile.id,
    payload: {
      providerProfileId: profile.id,
      userId: profile.userId,
      from: profile.status,
      to: input.status,
      changedBy: input.changedBy,
      reason: input.reason ?? null,
    },
  });

  return { providerProfileId: updated!.id, status: updated!.status };
}
