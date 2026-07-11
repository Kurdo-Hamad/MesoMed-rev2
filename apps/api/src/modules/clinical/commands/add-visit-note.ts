/**
 * Visit-note commands (MM-PLAN-001 §3.5): notes append, corrections are
 * amendment rows targeting the original — content is never UPDATEd, and
 * the DB layer (append-only trigger + SECURITY DEFINER channel) enforces
 * the same rules underneath this code.
 *
 * Layer b (§3.6): only the encounter's owning doctor writes notes.
 */
import { validateAmendmentTarget } from "@mesomed/domain/clinical";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { Session } from "../../../kernel/context.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { addVisitNoteRow, readVisitNotes, requireEncounterActor } from "../shared.js";

export interface VisitNoteResult {
  visitNoteId: string;
  encounterId: string;
  amendsNoteId: string | null;
}

async function appendNote(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: { encounterId: string; amendsNoteId: string | null; content: string },
): Promise<VisitNoteResult> {
  const visitNoteId = await addVisitNoteRow(tx, {
    encounterId: input.encounterId,
    amendsNoteId: input.amendsNoteId,
    author: session.userId,
    content: input.content,
  });

  await outbox.emit(tx, {
    name: "clinical.visit_note_added.v1",
    aggregateType: "encounter",
    aggregateId: input.encounterId,
    payload: {
      visitNoteId,
      encounterId: input.encounterId,
      authorUserId: session.userId,
      amendsNoteId: input.amendsNoteId,
    },
  });

  return { visitNoteId, encounterId: input.encounterId, amendsNoteId: input.amendsNoteId };
}

export async function addVisitNote(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: { encounterId: string; content: string },
): Promise<VisitNoteResult> {
  await requireEncounterActor(tx, session, input.encounterId, ["owning_doctor"]);
  return appendNote(tx, outbox, session, { ...input, amendsNoteId: null });
}

export async function amendVisitNote(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: { encounterId: string; visitNoteId: string; content: string },
): Promise<VisitNoteResult> {
  await requireEncounterActor(tx, session, input.encounterId, ["owning_doctor"]);

  const notes = await readVisitNotes(tx, session.userId, input.encounterId);
  const target = notes.find((note) => note.id === input.visitNoteId);
  if (!target) throw new AppError(ErrorCode.NOT_FOUND, "Visit note not found on this encounter");

  const verdict = validateAmendmentTarget({
    encounterId: target.encounterId,
    amendsNoteId: target.amendsNoteId,
  });
  if (!verdict.ok) {
    // The DB channel re-checks this invariant; here it becomes a typed error.
    throw new AppError(
      ErrorCode.VALIDATION,
      "Amendments must target an original note, not another amendment",
    );
  }

  return appendNote(tx, outbox, session, {
    encounterId: input.encounterId,
    amendsNoteId: input.visitNoteId,
    content: input.content,
  });
}
