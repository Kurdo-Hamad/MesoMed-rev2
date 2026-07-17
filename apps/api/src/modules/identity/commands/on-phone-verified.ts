/**
 * Runs when Better Auth proves phone ownership (patient signup/recovery).
 * All identity-module state — the patient role and the profile claim — and
 * the events describing it are written in ONE transaction (§3.2). Better
 * Auth's own user/verification writes commit separately (its API, not
 * ours); if this hook fails the verify endpoint fails and the client
 * retries claim through `identity.claimProfile`, which is idempotent.
 * Recorded in ADR-0004.
 */

import { eq, user, type Db } from "@mesomed/db";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { claimPatientProfile } from "./claim-patient-profile.js";
import { ensurePatientRegistration } from "./ensure-patient-registration.js";

export type OnPhoneVerified = (input: { userId: string; phoneNumber: string }) => Promise<void>;

export function createOnPhoneVerified(deps: { db: Db; outbox: OutboxEmitter }): OnPhoneVerified {
  return async ({ userId, phoneNumber }) => {
    await deps.db.transaction(async (tx) => {
      const [account] = await tx.select({ name: user.name }).from(user).where(eq(user.id, userId));

      await ensurePatientRegistration(tx, deps.outbox, { userId });

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
