/**
 * Support-grant reads (§3.5). Grant METADATA (who, why, until when) is
 * ordinary admin data readable directly; visit-note CONTENT behind a grant
 * comes only from the SECURITY DEFINER support function, which enforces
 * the expiry window in the database and audits the read.
 */
import { desc, eq, supportAccessGrants, type DbExecutor } from "@mesomed/db/modules/clinical";
import type { Session } from "../../../kernel/context.js";
import { supportReadVisitNotes } from "../shared.js";
import type { VisitNoteView } from "./encounters.js";

export interface SupportGrantView {
  grantId: string;
  encounterId: string;
  adminUserId: string;
  grantedBy: string;
  reason: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export async function listSupportGrants(
  db: DbExecutor,
  filter: { encounterId?: string | undefined },
): Promise<{ grants: SupportGrantView[] }> {
  const rows = await db
    .select()
    .from(supportAccessGrants)
    .where(
      filter.encounterId === undefined
        ? undefined
        : eq(supportAccessGrants.encounterId, filter.encounterId),
    )
    .orderBy(desc(supportAccessGrants.createdAt));
  return {
    grants: rows.map((row) => ({
      grantId: row.id,
      encounterId: row.encounterId,
      adminUserId: row.adminUserId,
      grantedBy: row.grantedBy,
      reason: row.reason,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/** Visit notes reachable through a usable grant held by the session admin. */
export async function getSupportNotes(
  db: DbExecutor,
  session: Session,
  grantId: string,
): Promise<{ encounterId: string; notes: VisitNoteView[] }> {
  const notes = await supportReadVisitNotes(db, grantId, session.userId);
  const [grant] = await db
    .select({ encounterId: supportAccessGrants.encounterId })
    .from(supportAccessGrants)
    .where(eq(supportAccessGrants.id, grantId));
  return {
    // supportReadVisitNotes threw unless the grant exists and is usable.
    encounterId: grant?.encounterId ?? grantId,
    notes: notes.map((note) => ({
      visitNoteId: note.id,
      encounterId: note.encounterId,
      amendsNoteId: note.amendsNoteId,
      authorUserId: note.authorUserId,
      content: note.content,
      createdAt: note.createdAt.toISOString(),
    })),
  };
}
