/**
 * Guest booking creates an unverified, phone-keyed patient profile — no
 * password, no OTP (MM-DEC rev02 §1). This is the identity-side command
 * the Phase 4 booking command calls (published function, not a public
 * endpoint). Idempotent on the normalized phone: the same guest booking
 * twice, in any phone spelling, yields one profile and one event.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import { normalizePhone } from "@mesomed/domain/identity";
import { eq, patientProfiles, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";

export interface CreateGuestPatientProfileInput {
  fullName: string;
  phone: string;
  dateOfBirth?: string;
  gender?: "male" | "female";
  email?: string;
}

export interface CreateGuestPatientProfileResult {
  profileId: string;
  /** False when a profile already existed for this phone. */
  created: boolean;
}

export async function createGuestPatientProfile(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: CreateGuestPatientProfileInput,
): Promise<CreateGuestPatientProfileResult> {
  const normalized = normalizePhone(input.phone);
  if (normalized === null) {
    throw new AppError(ErrorCode.VALIDATION, "Invalid phone number");
  }

  const [inserted] = await tx
    .insert(patientProfiles)
    .values({
      normalizedPhone: normalized,
      fullName: input.fullName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      email: input.email,
    })
    .onConflictDoNothing({ target: patientProfiles.normalizedPhone })
    .returning({ id: patientProfiles.id });

  if (!inserted) {
    const [existing] = await tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, normalized));
    if (!existing) {
      throw new AppError(ErrorCode.INTERNAL, "Profile neither inserted nor found");
    }
    return { profileId: existing.id, created: false };
  }

  await outbox.emit(tx, {
    name: "identity.patient_profile_created.v2",
    aggregateType: "patient_profile",
    aggregateId: inserted.id,
    payload: { profileId: inserted.id, source: "guest_booking" },
  });
  return { profileId: inserted.id, created: true };
}
