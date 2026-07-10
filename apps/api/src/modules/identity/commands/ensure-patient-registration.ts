/**
 * Idempotently grants the patient role and emits the registration events
 * exactly once per user. Shared by the phone-verification hook and the
 * claim procedure (email-path patients never pass through the phone hook).
 */
import { userRoles, type DbTransaction } from "@mesomed/db";
import type { OutboxEmitter } from "../../../kernel/outbox.js";

export async function ensurePatientRegistration(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: { userId: string; phone: string | null; email: string | null },
): Promise<void> {
  const inserted = await tx
    .insert(userRoles)
    .values({ userId: input.userId, role: "patient" })
    .onConflictDoNothing()
    .returning({ userId: userRoles.userId });

  // First registration only — re-verification and re-claims emit nothing.
  if (inserted.length === 0) return;

  await outbox.emit(tx, {
    name: "identity.user_registered.v1",
    aggregateType: "user",
    aggregateId: input.userId,
    payload: { userId: input.userId, userType: "patient", phone: input.phone, email: input.email },
  });
  await outbox.emit(tx, {
    name: "identity.role_assigned.v1",
    aggregateType: "user",
    aggregateId: input.userId,
    payload: { userId: input.userId, role: "patient" },
  });
}
