/**
 * Time-boxed admin support-access grants (MM-PLAN-001 §3.5): admins reach
 * visit-note content ONLY through an explicit grant with enforced expiry.
 * Creation, revocation and every use are audited — by the DB triggers and
 * the SECURITY DEFINER channel, not by this code.
 *
 * The expiry window policy is the pure rule in `@mesomed/domain/clinical`;
 * the database re-enforces expiry at read time regardless.
 */
import { validateGrantWindow } from "@mesomed/domain/clinical";
import { ErrorCode } from "@mesomed/contracts/errors";
import { eq, supportAccessGrants, type DbTransaction } from "@mesomed/db/modules/clinical";
import { AppError } from "../../../kernel/errors.js";
import type { Session } from "../../../kernel/context.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { grantSupportAccessRow, revokeSupportAccessRow } from "../shared.js";

export interface GrantSupportAccessResult {
  grantId: string;
  encounterId: string;
  expiresAt: string;
}

export async function grantSupportAccess(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: { encounterId: string; reason: string; expiresAt: Date },
  now: Date = new Date(),
): Promise<GrantSupportAccessResult> {
  const verdict = validateGrantWindow(now, input.expiresAt);
  if (!verdict.ok) {
    throw new AppError(
      ErrorCode.VALIDATION,
      verdict.reason === "expiry_not_in_future"
        ? "Grant expiry must be in the future"
        : "Grant window exceeds the policy maximum",
    );
  }

  // Grants are self-issued to the requesting admin with a mandatory reason;
  // creation itself is audited and support reads re-check the grant in-DB.
  const grantId = await grantSupportAccessRow(tx, {
    encounterId: input.encounterId,
    adminUserId: session.userId,
    grantedBy: session.userId,
    reason: input.reason,
    expiresAt: input.expiresAt,
  });

  await outbox.emit(tx, {
    name: "clinical.support_access_granted.v1",
    aggregateType: "support_access_grant",
    aggregateId: grantId,
    payload: {
      grantId,
      encounterId: input.encounterId,
      adminUserId: session.userId,
      grantedBy: session.userId,
      reason: input.reason,
      expiresAt: input.expiresAt.toISOString(),
    },
  });

  return { grantId, encounterId: input.encounterId, expiresAt: input.expiresAt.toISOString() };
}

export async function revokeSupportAccess(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: { grantId: string },
): Promise<{ grantId: string; revoked: boolean }> {
  const revoked = await revokeSupportAccessRow(tx, input.grantId, session.userId);
  if (!revoked) return { grantId: input.grantId, revoked: false };

  const [grant] = await tx
    .select({ encounterId: supportAccessGrants.encounterId })
    .from(supportAccessGrants)
    .where(eq(supportAccessGrants.id, input.grantId));
  if (!grant) throw new AppError(ErrorCode.INTERNAL, "Revoked grant row missing");

  await outbox.emit(tx, {
    name: "clinical.support_access_revoked.v1",
    aggregateType: "support_access_grant",
    aggregateId: input.grantId,
    payload: {
      grantId: input.grantId,
      encounterId: grant.encounterId,
      revokedBy: session.userId,
    },
  });

  return { grantId: input.grantId, revoked: true };
}
