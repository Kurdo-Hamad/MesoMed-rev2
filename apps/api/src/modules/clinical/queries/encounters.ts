/**
 * Clinical read queries (§3.6 layer b in-handler): a doctor lists/reads
 * encounters bound to their directory profile; a patient reads their own.
 * Every read flows through the audited SECURITY DEFINER channel — there is
 * deliberately no unaudited read of clinical rows anywhere in the module.
 */
import type { DbExecutor } from "@mesomed/db";
import type { Session } from "../../../kernel/context.js";
import {
  readEncounters,
  readVisitNotes,
  requireDoctorProfileId,
  requireEncounterActor,
  requirePatientProfileId,
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

function toEncounterView(row: EncounterRow): EncounterView {
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

function toVisitNoteView(row: VisitNoteRow): VisitNoteView {
  return {
    visitNoteId: row.id,
    encounterId: row.encounterId,
    amendsNoteId: row.amendsNoteId,
    authorUserId: row.authorUserId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Encounters of the session doctor's own directory profile. */
export async function listDoctorEncounters(
  db: DbExecutor,
  session: Session,
): Promise<{ encounters: EncounterView[] }> {
  const doctorProfileId = await requireDoctorProfileId(db, session);
  const rows = await readEncounters(db, session.userId, { doctorProfileId });
  return { encounters: rows.map(toEncounterView) };
}

/** Encounters of the session patient's own claimed profile. */
export async function listMyEncounters(
  db: DbExecutor,
  session: Session,
): Promise<{ encounters: EncounterView[] }> {
  const patientProfileId = await requirePatientProfileId(db, session);
  const rows = await readEncounters(db, session.userId, { patientProfileId });
  return { encounters: rows.map(toEncounterView) };
}

/**
 * Visit notes of one encounter, in creation order (originals with their
 * amendments), for the owning doctor or the patient the encounter is about.
 */
export async function getEncounterNotes(
  db: DbExecutor,
  session: Session,
  encounterId: string,
): Promise<{ encounterId: string; notes: VisitNoteView[] }> {
  await requireEncounterActor(db, session, encounterId, ["owning_doctor", "patient_owner"]);
  const notes = await readVisitNotes(db, session.userId, encounterId);
  return { encounterId, notes: notes.map(toVisitNoteView) };
}
