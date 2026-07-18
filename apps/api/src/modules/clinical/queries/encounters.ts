/**
 * Clinical read queries (§3.6 layer b in-handler): a doctor lists/reads
 * encounters bound to their directory profile; a patient reads their own.
 * Every read flows through the audited SECURITY DEFINER channel — there is
 * deliberately no unaudited read of clinical rows anywhere in the module.
 */
import { decodeEncounterCursor, encodeEncounterCursor } from "@mesomed/domain/clinical";
import type { DbExecutor } from "@mesomed/db/modules/clinical";
import type { Session } from "../../../kernel/context.js";
import {
  readEncounters,
  readVisitNotes,
  requireDoctorProfileId,
  requireEncounterActor,
  requirePatientProfileId,
  type EncounterPage,
  type EncounterRow,
  type VisitNoteRow,
} from "../shared.js";

export interface EncounterView {
  encounterId: string;
  appointmentId: string;
  doctorProfileId: string;
  patientProfileId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export function toEncounterView(row: EncounterRow): EncounterView {
  return {
    encounterId: row.id,
    appointmentId: row.appointmentId,
    doctorProfileId: row.doctorProfileId,
    patientProfileId: row.patientProfileId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export interface VisitNoteView {
  visitNoteId: string;
  encounterId: string;
  amendsNoteId: string | null;
  authorUserId: string;
  content: string;
  createdAt: string;
}

export function toVisitNoteView(row: VisitNoteRow): VisitNoteView {
  return {
    visitNoteId: row.id,
    encounterId: row.encounterId,
    amendsNoteId: row.amendsNoteId,
    authorUserId: row.authorUserId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Keyset pagination (MM-QA-004 F-12) ─────────────────────────────────

export interface ListEncountersPageInput {
  limit?: number;
  cursor?: string;
}

/**
 * Mirrors the contract's schema default — applied here because the whole
 * input object is optional at the router (pre-pagination clients call
 * with no args, so the schema default never materializes for them).
 */
const DEFAULT_ENCOUNTERS_LIMIT = 50;

export function toEncounterPage(input: ListEncountersPageInput | undefined): EncounterPage {
  const cursor = decodeEncounterCursor(input?.cursor);
  return {
    limit: input?.limit ?? DEFAULT_ENCOUNTERS_LIMIT,
    // Malformed/tampered cursor decodes to null → page one (directory precedent).
    ...(cursor ? { before: { startsAt: new Date(cursor.s), id: cursor.i } } : {}),
  };
}

/**
 * Exact-limit variant: the DB audits exactly the returned rows, so "more
 * may exist" is derived from a full page — the final full page yields one
 * empty follow-up page instead of a probe row that would be read and
 * audited without ever being served.
 */
export function encountersNextCursor(rows: EncounterRow[], limit: number): string | null {
  const last = rows[rows.length - 1];
  return rows.length === limit && last
    ? encodeEncounterCursor({ s: last.startsAt.toISOString(), i: last.id })
    : null;
}

/** Encounters of the session doctor's own directory profile. */
export async function listDoctorEncounters(
  db: DbExecutor,
  session: Session,
  input?: ListEncountersPageInput,
): Promise<{ encounters: EncounterView[]; nextCursor: string | null }> {
  const doctorProfileId = await requireDoctorProfileId(db, session);
  const page = toEncounterPage(input);
  const rows = await readEncounters(db, session.userId, { doctorProfileId }, page);
  return {
    encounters: rows.map(toEncounterView),
    nextCursor: encountersNextCursor(rows, page.limit),
  };
}

/** Encounters of the session patient's own claimed profile. */
export async function listMyEncounters(
  db: DbExecutor,
  session: Session,
  input?: ListEncountersPageInput,
): Promise<{ encounters: EncounterView[]; nextCursor: string | null }> {
  const patientProfileId = await requirePatientProfileId(db, session);
  const page = toEncounterPage(input);
  const rows = await readEncounters(db, session.userId, { patientProfileId }, page);
  return {
    encounters: rows.map(toEncounterView),
    nextCursor: encountersNextCursor(rows, page.limit),
  };
}

/**
 * Visit notes of one encounter, in creation order (originals with their
 * amendments), for the owning doctor or the patient the encounter is about.
 * The limit is a hard cap applied app-side (MM-QA-004 F-12): the
 * single-encounter DB function has no limit parameter and its audit
 * granularity is per-encounter (one 'notes_read' row per call), unchanged.
 */
export async function getEncounterNotes(
  db: DbExecutor,
  session: Session,
  input: { encounterId: string; limit: number },
): Promise<{ encounterId: string; notes: VisitNoteView[] }> {
  await requireEncounterActor(db, session, input.encounterId, ["owning_doctor", "patient_owner"]);
  const notes = await readVisitNotes(db, session.userId, input.encounterId);
  return {
    encounterId: input.encounterId,
    notes: notes.slice(0, input.limit).map(toVisitNoteView),
  };
}
