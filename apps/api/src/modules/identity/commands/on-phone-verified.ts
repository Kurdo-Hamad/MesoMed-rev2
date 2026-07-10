/**
 * Runs when Better Auth proves phone ownership (patient signup/recovery).
 * All identity-module state — the patient role and the profile claim — and
 * the events describing it are written in ONE transaction (§3.2). Better
 * Auth's own user/verification writes commit separately (its API, not
 * ours); if this hook fails the verify endpoint fails and the client
 * retries claim through `identity.claimProfile`, which is idempotent.
 * Recorded in ADR-0004.
 */

import { eq, user, userRoles, type Db } from "@mesomed/db";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { claimPatientProfile } from "./claim-patient-profile.js";

export type OnPhoneVerified = (input: { userId: string; phoneNumber: string }) => Promise<void>;

export function createOnPhoneVerified(deps: { db: Db; outbox: OutboxEmitter }): OnPhoneVerified {
  return async ({ userId, phoneNumber }) => {
    await deps.db.transaction(async (tx) => {
      const [account] = await tx
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, userId));

      const inserted = await tx
        .insert(userRoles)
        .values({ userId, role: "patient" })
        .onConflictDoNothing()
        .returning({ userId: userRoles.userId });

      // First verification = registration; re-verification (recovery,
      // repeated OTP) must not duplicate registration events.
      if (inserted.length > 0) {
        await deps.outbox.emit(tx, {
          name: "identity.user_registered.v1",
          aggregateType: "user",
          aggregateId: userId,
          payload: { userId, userType: "patient", phone: phoneNumber, email: null },
        });
        await deps.outbox.emit(tx, {
          name: "identity.role_assigned.v1",
          aggregateType: "user",
          aggregateId: userId,
          payload: { userId, role: "patient" },
        });
      }

      await claimPatientProfile(tx, deps.outbox, {
        userId,
        normalizedPhone: phoneNumber,
        proof: "otp-verified-phone",
        // Better Auth just verified this phone for this user.
        proofVerified: true,
        fullNameFallback: account?.name ?? phoneNumber,
      });
    });
  };
}
