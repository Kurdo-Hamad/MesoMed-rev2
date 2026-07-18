/**
 * Guest-profile claim (MM-DEC rev02 §2/§9, convention #7): upgrades the
 * phone-keyed profile in place, atomically, only with verified ownership
 * proof. The pure decision rule lives in @mesomed/domain/identity; this
 * command applies it inside the caller's transaction and emits the events
 * in the same transaction — there is no code path here (or anywhere) that
 * claims without a proof, and `decideClaim` rejects unverified proof.
 */

import { ErrorCode } from "@mesomed/contracts/errors";
import type { ClaimProof } from "@mesomed/contracts/identity";
import { decideClaim } from "@mesomed/domain/identity";
import { and, eq, isNull, patientProfiles, type DbTransaction } from "@mesomed/db/modules/identity";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";

export interface ClaimPatientProfileInput {
  userId: string;
  normalizedPhone: string;
  proof: ClaimProof;
  /** Verified server-side by the caller in the same transaction. */
  proofVerified: boolean;
  /** Name for a fresh profile when no guest profile exists. */
  fullNameFallback: string;
}

export interface ClaimPatientProfileResult {
  profileId: string;
  /** False when the caller already owned the profile (idempotent re-claim). */
  changed: boolean;
}

export async function claimPatientProfile(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: ClaimPatientProfileInput,
): Promise<ClaimPatientProfileResult> {
  const [profile] = await tx
    .select({ id: patientProfiles.id, userId: patientProfiles.userId })
    .from(patientProfiles)
    .where(eq(patientProfiles.normalizedPhone, input.normalizedPhone))
    .for("update");

  const decision = decideClaim({
    proofVerified: input.proofVerified,
    callerUserId: input.userId,
    profile: profile ?? null,
  });

  switch (decision.action) {
    case "reject":
      throw decision.reason === "proof-not-verified"
        ? new AppError(
            input.proof === "verified-email"
              ? ErrorCode.EMAIL_NOT_VERIFIED
              : ErrorCode.PHONE_NOT_VERIFIED,
            "Ownership proof is not verified",
          )
        : new AppError(
            ErrorCode.PROFILE_ALREADY_CLAIMED,
            "This phone number is already linked to another account",
          );

    case "already-owned":
      return { profileId: profile!.id, changed: false };

    case "claim": {
      const [claimed] = await tx
        .update(patientProfiles)
        .set({ userId: input.userId, claimedAt: new Date() })
        .where(and(eq(patientProfiles.id, profile!.id), isNull(patientProfiles.userId)))
        .returning({ id: patientProfiles.id });
      if (!claimed) {
        // Lost a race despite the row lock — treat as claimed elsewhere.
        throw new AppError(
          ErrorCode.PROFILE_ALREADY_CLAIMED,
          "This phone number is already linked to another account",
        );
      }
      await outbox.emit(tx, {
        name: "identity.profile_claimed.v1",
        aggregateType: "patient_profile",
        aggregateId: claimed.id,
        payload: { profileId: claimed.id, userId: input.userId, proof: input.proof },
      });
      return { profileId: claimed.id, changed: true };
    }

    case "create": {
      const [created] = await tx
        .insert(patientProfiles)
        .values({
          userId: input.userId,
          normalizedPhone: input.normalizedPhone,
          fullName: input.fullNameFallback,
          claimedAt: new Date(),
        })
        .returning({ id: patientProfiles.id });
      if (!created) {
        throw new AppError(ErrorCode.INTERNAL, "Failed to create patient profile");
      }
      await outbox.emit(tx, {
        name: "identity.patient_profile_created.v2",
        aggregateType: "patient_profile",
        aggregateId: created.id,
        payload: { profileId: created.id, source: "registration" },
      });
      await outbox.emit(tx, {
        name: "identity.profile_claimed.v1",
        aggregateType: "patient_profile",
        aggregateId: created.id,
        payload: { profileId: created.id, userId: input.userId, proof: input.proof },
      });
      return { profileId: created.id, changed: true };
    }
  }
}
