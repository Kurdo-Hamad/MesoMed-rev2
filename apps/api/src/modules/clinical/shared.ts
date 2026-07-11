/**
 * Clinical module internals (MM-PLAN-001 §5 Phase 5). The tables carry
 * RLS with zero policies and zero API-role grants, so every read/write
 * goes through the SECURITY DEFINER channel created in migration 0004 —
 * these wrappers are the only place the module touches SQL, and each call
 * is recorded in `clinical_access_log` by the database itself.
 *
 * Layer-b authorization (§3.6) happens in the callers before the channel
 * is invoked; the scope parameters passed down are defense-in-depth, not
 * the authorization decision.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import { sql, type DbExecutor } from "@mesomed/db";
import { AppError } from "../../kernel/errors.js";
import type { Session } from "../../kernel/context.js";
import { getDoctorProfileIdForUser } from "../directory/queries/doctor-profile-refs.js";
import { getPatientProfileIdForUser } from "../identity/queries/user-profiles.js";

/** Actor recorded for encounter creation by the outbox subscriber. */
export const SYSTEM_ACTOR = "system:outbox";

export interface EncounterRow {
  id: string;
  appointmentId: string;
  doctorProfileId: string;
  patientProfileId: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
}

export interface VisitNoteRow {
  id: string;
  encounterId: string;
  amendsNoteId: string | null;
  authorUserId: string;
  content: string;
  createdAt: Date;
}

/**
 * Raise messages from the SECURITY DEFINER functions, translated to typed
 * AppErrors (§3.11). The DB is the enforcement layer; this mapping only
 * decides what the client sees.
 */
const DB_ERROR_TO_APP: ReadonlyArray<[pattern: string, code: ErrorCode, message: string]> = [
  ["SUPPORT_GRANT_EXPIRED", ErrorCode.SUPPORT_GRANT_EXPIRED, "Support access grant has expired"],
  ["SUPPORT_GRANT_INVALID", ErrorCode.SUPPORT_GRANT_INVALID, "Support access grant is not usable"],
  ["CLINICAL_ENCOUNTER_NOT_FOUND", ErrorCode.NOT_FOUND, "Encounter not found"],
  [
    "CLINICAL_AMEND_TARGET_INVALID",
    ErrorCode.VALIDATION,
    "Amendments must target an original note of the same encounter",
  ],
];

/** Re-throw a clinical-channel error as its typed AppError when it is one. */
export function translateClinicalDbError(error: unknown): never {
  for (let cursor = error; cursor instanceof Error; cursor = cursor.cause as Error | undefined) {
    for (const [pattern, code, message] of DB_ERROR_TO_APP) {
      if (cursor.message.includes(pattern)) {
        throw new AppError(code, message, { cause: error });
      }
    }
  }
  throw error;
}

// Type aliases, not interfaces: drizzle's execute<T> constrains T to
// Record<string, unknown>, which aliases satisfy structurally. Raw
// execute() rows carry timestamptz as strings (no schema type mapping),
// so timestamps are normalized here.
const toDate = (value: string | Date): Date => (value instanceof Date ? value : new Date(value));

type EncounterSqlRow = {
  id: string;
  appointment_id: string;
  doctor_profile_id: string;
  patient_profile_id: string;
  starts_at: string | Date;
  ends_at: string | Date;
  created_at: string | Date;
};

function toEncounterRow(row: EncounterSqlRow): EncounterRow {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    doctorProfileId: row.doctor_profile_id,
    patientProfileId: row.patient_profile_id,
    startsAt: toDate(row.starts_at),
    endsAt: toDate(row.ends_at),
    createdAt: toDate(row.created_at),
  };
}

type VisitNoteSqlRow = {
  id: string;
  encounter_id: string;
  amends_note_id: string | null;
  author_user_id: string;
  content: string;
  created_at: string | Date;
};

function toVisitNoteRow(row: VisitNoteSqlRow): VisitNoteRow {
  return {
    id: row.id,
    encounterId: row.encounter_id,
    amendsNoteId: row.amends_note_id,
    authorUserId: row.author_user_id,
    content: row.content,
    createdAt: toDate(row.created_at),
  };
}

// ── The SECURITY DEFINER channel ───────────────────────────────────────

/** Idempotent create — `created` is false when the encounter already existed. */
export async function createEncounter(
  db: DbExecutor,
  input: {
    appointmentId: string;
    doctorProfileId: string;
    patientProfileId: string;
    startsAt: Date;
    endsAt: Date;
    actor: string;
  },
): Promise<{ encounterId: string; created: boolean }> {
  const result = await db.execute<{ encounter_id: string; created: boolean }>(
    sql`select * from clinical_create_encounter(${input.appointmentId}, ${input.doctorProfileId}, ${input.patientProfileId}, ${input.startsAt}, ${input.endsAt}, ${input.actor})`,
  );
  const row = result.rows[0];
  if (!row) throw new AppError(ErrorCode.INTERNAL, "clinical_create_encounter returned no row");
  return { encounterId: row.encounter_id, created: row.created };
}

export async function readEncounters(
  db: DbExecutor,
  actor: string,
  scope: { encounterId?: string; doctorProfileId?: string; patientProfileId?: string },
): Promise<EncounterRow[]> {
  try {
    const result = await db.execute<EncounterSqlRow>(
      sql`select * from clinical_read_encounters(${actor}, ${scope.encounterId ?? null}, ${scope.doctorProfileId ?? null}, ${scope.patientProfileId ?? null})`,
    );
    return result.rows.map(toEncounterRow);
  } catch (error) {
    translateClinicalDbError(error);
  }
}

export async function addVisitNoteRow(
  db: DbExecutor,
  input: { encounterId: string; amendsNoteId: string | null; author: string; content: string },
): Promise<string> {
  try {
    const result = await db.execute<{ clinical_add_visit_note: string }>(
      sql`select clinical_add_visit_note(${input.encounterId}, ${input.amendsNoteId}, ${input.author}, ${input.content})`,
    );
    const row = result.rows[0];
    if (!row) throw new AppError(ErrorCode.INTERNAL, "clinical_add_visit_note returned no row");
    return row.clinical_add_visit_note;
  } catch (error) {
    translateClinicalDbError(error);
  }
}

export async function readVisitNotes(
  db: DbExecutor,
  actor: string,
  encounterId: string,
): Promise<VisitNoteRow[]> {
  try {
    const result = await db.execute<VisitNoteSqlRow>(
      sql`select * from clinical_read_visit_notes(${actor}, ${encounterId})`,
    );
    return result.rows.map(toVisitNoteRow);
  } catch (error) {
    translateClinicalDbError(error);
  }
}

export async function grantSupportAccessRow(
  db: DbExecutor,
  input: {
    encounterId: string;
    adminUserId: string;
    grantedBy: string;
    reason: string;
    expiresAt: Date;
  },
): Promise<string> {
  try {
    const result = await db.execute<{ clinical_grant_support_access: string }>(
      sql`select clinical_grant_support_access(${input.encounterId}, ${input.adminUserId}, ${input.grantedBy}, ${input.reason}, ${input.expiresAt})`,
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(ErrorCode.INTERNAL, "clinical_grant_support_access returned no row");
    }
    return row.clinical_grant_support_access;
  } catch (error) {
    translateClinicalDbError(error);
  }
}

/** True when this call performed the revocation (false = already revoked). */
export async function revokeSupportAccessRow(
  db: DbExecutor,
  grantId: string,
  actor: string,
): Promise<boolean> {
  try {
    const result = await db.execute<{ clinical_revoke_support_access: boolean }>(
      sql`select clinical_revoke_support_access(${grantId}, ${actor})`,
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(ErrorCode.INTERNAL, "clinical_revoke_support_access returned no row");
    }
    return row.clinical_revoke_support_access;
  } catch (error) {
    translateClinicalDbError(error);
  }
}

export async function supportReadVisitNotes(
  db: DbExecutor,
  grantId: string,
  actor: string,
): Promise<VisitNoteRow[]> {
  try {
    const result = await db.execute<VisitNoteSqlRow>(
      sql`select * from clinical_support_read_visit_notes(${grantId}, ${actor})`,
    );
    return result.rows.map(toVisitNoteRow);
  } catch (error) {
    translateClinicalDbError(error);
  }
}

// ── Layer-b actor checks (§3.6) ────────────────────────────────────────

/**
 * The session's doctor profile, or FORBIDDEN — a doctor-role session with
 * no directory profile owns no encounters.
 */
export async function requireDoctorProfileId(db: DbExecutor, session: Session): Promise<string> {
  const doctorProfileId = await getDoctorProfileIdForUser(db, session.userId);
  if (doctorProfileId === null) {
    throw new AppError(ErrorCode.FORBIDDEN, "No doctor profile for this account");
  }
  return doctorProfileId;
}

/** The session's claimed patient profile, or FORBIDDEN. */
export async function requirePatientProfileId(db: DbExecutor, session: Session): Promise<string> {
  const patientProfileId = await getPatientProfileIdForUser(db, session.userId);
  if (patientProfileId === null) {
    throw new AppError(ErrorCode.FORBIDDEN, "No patient profile for this account");
  }
  return patientProfileId;
}

export type EncounterActor = "owning_doctor" | "patient_owner";

/**
 * Load the encounter and prove the session is bound to it as one of the
 * allowed actors (admin passes only where explicitly allowed by the
 * caller's list — clinical content has no implicit admin path; admins go
 * through support grants). The read is audited by the DB channel.
 */
export async function requireEncounterActor(
  db: DbExecutor,
  session: Session,
  encounterId: string,
  allowed: readonly EncounterActor[],
): Promise<EncounterRow> {
  const [encounter] = await readEncounters(db, session.userId, { encounterId });
  if (!encounter) throw new AppError(ErrorCode.NOT_FOUND, "Encounter not found");

  if (allowed.includes("owning_doctor") && session.roles.includes("doctor")) {
    const doctorProfileId = await getDoctorProfileIdForUser(db, session.userId);
    if (doctorProfileId !== null && doctorProfileId === encounter.doctorProfileId) {
      return encounter;
    }
  }
  if (allowed.includes("patient_owner") && session.roles.includes("patient")) {
    const patientProfileId = await getPatientProfileIdForUser(db, session.userId);
    if (patientProfileId !== null && patientProfileId === encounter.patientProfileId) {
      return encounter;
    }
  }
  throw new AppError(ErrorCode.FORBIDDEN, "Not authorized for this encounter");
}
