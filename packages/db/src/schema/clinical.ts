import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Clinical module tables (MM-PLAN-001 §5 Phase 5) — owned exclusively by
 * `apps/api/src/modules/clinical` (§3.1). `appointmentId` (booking),
 * `doctorProfileId` (directory) and `patientProfileId` (identity) are
 * cross-module references stored without FK constraints, denormalized from
 * the `booking.completed.v1` snapshot — clinical never joins other
 * modules' tables.
 *
 * DB-layer guardrails (§3.5/§3.6) live in migration 0004's hand-written
 * tail, outside drizzle's model: the SECURITY DEFINER audit trigger,
 * append-only enforcement triggers, the `mesomed_api` role and grants, and
 * the SECURITY DEFINER access functions. RLS enablement on `encounters` /
 * `visit_notes` IS modeled here (`enableRLS`) so drizzle-kit never
 * generates a disable on later diffs. Deny-all is the absence of policies:
 * non-owners cannot touch these tables at all; the only channel is the
 * definer functions.
 */

export const encounters = pgTable(
  "encounters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id").notNull(),
    doctorProfileId: uuid("doctor_profile_id").notNull(),
    patientProfileId: uuid("patient_profile_id").notNull(),
    /** Snapshot of the completed appointment's occurrence window (UTC). */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** 1:1 with the appointment — the idempotency backstop under redelivery. */
    uniqueIndex("encounters_appointment_unique").on(table.appointmentId),
    index("encounters_doctor_profile_idx").on(table.doctorProfileId, table.startsAt),
    index("encounters_patient_profile_idx").on(table.patientProfileId, table.startsAt),
    check("encounters_window_check", sql`${table.startsAt} < ${table.endsAt}`),
  ],
).enableRLS();

export const visitNotes = pgTable(
  "visit_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id),
    /** Null on an original note; the amended ORIGINAL's id on an amendment. */
    amendsNoteId: uuid("amends_note_id"),
    authorUserId: text("author_user_id").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("visit_notes_encounter_idx").on(table.encounterId, table.createdAt),
    index("visit_notes_amends_idx").on(table.amendsNoteId),
    check("visit_notes_no_self_amend_check", sql`${table.amendsNoteId} <> ${table.id}`),
  ],
).enableRLS();

/**
 * Append-only clinical access audit (§3.5). Rows are produced by the
 * SECURITY DEFINER trigger on clinical writes and by the SECURITY DEFINER
 * read functions — never by application inserts. UPDATE/DELETE are denied
 * to every role by grants AND blocked by trigger (superuser included).
 */
export const clinicalAccessLog = pgTable(
  "clinical_access_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** App-supplied actor (session user id / "system:…"), else current_user. */
    actorUserId: text("actor_user_id").notNull(),
    action: text("action").notNull(),
    encounterId: uuid("encounter_id"),
    visitNoteId: uuid("visit_note_id"),
    grantId: uuid("grant_id"),
    prescriptionId: uuid("prescription_id"),
  },
  (table) => [
    index("clinical_access_log_encounter_idx").on(table.encounterId, table.occurredAt),
    index("clinical_access_log_actor_idx").on(table.actorUserId, table.occurredAt),
    check(
      "clinical_access_log_action_check",
      sql`${table.action} in ('encounter_created', 'encounter_read', 'note_added', 'note_amended', 'notes_read', 'support_notes_read', 'grant_created', 'grant_revoked', 'prescription_issued', 'prescription_amended', 'prescription_discontinued', 'prescriptions_read')`,
    ),
  ],
);

export const PRESCRIPTION_STATUSES = ["active", "superseded", "discontinued"] as const;

/**
 * Doctor-authored prescriptions (clinical extension, ADR-0010). Content is
 * append-only (§3.5): an amendment is a NEW active row whose
 * `supersedesPrescriptionId` points at the prior revision, flipped
 * active → superseded in the same tx; discontinuation is a status flip
 * with no content change. Migration 0007's guardrail tail enforces this
 * (guard triggers, SECURITY DEFINER channel, audit) — same clinical tier
 * as encounters/visit_notes (§3.6 as amended by ADR-0010). The self-FK on
 * `supersedesPrescriptionId` is added in the migration tail (visit_notes
 * precedent).
 */
export const prescriptions = pgTable(
  "prescriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id),
    /** Denormalized from the encounter — enables patient-scoped reads. */
    doctorProfileId: uuid("doctor_profile_id").notNull(),
    patientProfileId: uuid("patient_profile_id").notNull(),
    medicationName: text("medication_name").notNull(),
    dosage: text("dosage").notNull(),
    frequency: text("frequency").notNull(),
    duration: text("duration").notNull(),
    instructions: text("instructions"),
    status: text("status", { enum: PRESCRIPTION_STATUSES }).notNull().default("active"),
    /** Null on an original revision; the superseded revision's id on an amendment. */
    supersedesPrescriptionId: uuid("supersedes_prescription_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("prescriptions_patient_profile_idx").on(table.patientProfileId, table.issuedAt),
    index("prescriptions_encounter_idx").on(table.encounterId),
    /** A revision can be superseded by at most one row — chains stay linear. */
    uniqueIndex("prescriptions_supersedes_unique")
      .on(table.supersedesPrescriptionId)
      .where(sql`${table.supersedesPrescriptionId} is not null`),
    check(
      "prescriptions_status_check",
      sql`${table.status} in ('active', 'superseded', 'discontinued')`,
    ),
    check(
      "prescriptions_no_self_supersede_check",
      sql`${table.supersedesPrescriptionId} <> ${table.id}`,
    ),
  ],
).enableRLS();

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"] as const;

/**
 * Patient-authored medical profile (ADR-0010, option A — locked): free
 * upsert by the owning patient, NO revision history, doctors read-only.
 * Patient-owned safety data the patient has no incentive to falsify;
 * deliberately outside the RLS/audit clinical tier — ordinary DML by
 * `mesomed_api`, ownership enforced in the handler (§3.6 layer b).
 * `patientProfileId` (identity) is a cross-module reference without FK.
 */
export const patientMedicalProfiles = pgTable(
  "patient_medical_profile",
  {
    /** One row per patient — the profile IS the patient's row. */
    patientProfileId: uuid("patient_profile_id").primaryKey(),
    bloodType: text("blood_type", { enum: BLOOD_TYPES }).notNull().default("unknown"),
    allergies: text("allergies").array().notNull().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "patient_medical_profile_blood_type_check",
      sql`${table.bloodType} in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown')`,
    ),
  ],
);

export const MEDICATION_SOURCES = ["self_prescribed", "over_the_counter"] as const;

/**
 * Patient-reported medications (ADR-0010) — patient-authored, structurally
 * distinct from clinical prescriptions in every payload, never merged into
 * one medication list. Not clinical records: hard delete is acceptable.
 * Same non-tier treatment as the medical profile (no RLS, no audit).
 */
export const patientReportedMedications = pgTable(
  "patient_reported_medications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientProfileId: uuid("patient_profile_id").notNull(),
    medicationName: text("medication_name").notNull(),
    dosage: text("dosage"),
    source: text("source", { enum: MEDICATION_SOURCES }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("patient_reported_medications_patient_idx").on(table.patientProfileId, table.createdAt),
    check(
      "patient_reported_medications_source_check",
      sql`${table.source} in ('self_prescribed', 'over_the_counter')`,
    ),
  ],
);

/** Time-boxed admin support-access grants (§3.5). */
export const supportAccessGrants = pgTable(
  "support_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id),
    /** The admin the grant authorizes. */
    adminUserId: text("admin_user_id").notNull(),
    grantedBy: text("granted_by").notNull(),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("support_access_grants_encounter_idx").on(table.encounterId),
    index("support_access_grants_admin_idx").on(table.adminUserId, table.expiresAt),
    check("support_access_grants_window_check", sql`${table.createdAt} < ${table.expiresAt}`),
    check("support_access_grants_reason_check", sql`length(${table.reason}) >= 5`),
  ],
);
