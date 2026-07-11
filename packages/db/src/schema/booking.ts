import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Booking module tables (MM-PLAN-001 §5 Phase 4) — owned exclusively by
 * `apps/api/src/modules/booking` (§3.1). `doctorLocationId` (scheduling)
 * and `patientProfileId` (identity) are cross-module references stored
 * without FK constraints (same precedent as scheduling — see that file's
 * header).
 *
 * Statuses and legal transitions are the ported state machine in
 * `packages/domain/booking` (transitions.ts). Instants are timestamptz
 * (UTC); the requested slot must match a generated schedule slot at
 * booking/reschedule time.
 */

export const APPOINTMENT_STATUSES = [
  "booked",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;

export const BOOKING_CHANNELS = ["guest_web", "patient_account", "secretary_walk_in"] as const;

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorLocationId: uuid("doctor_location_id").notNull(),
    patientProfileId: uuid("patient_profile_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: APPOINTMENT_STATUSES }).notNull().default("booked"),
    bookedVia: text("booked_via", { enum: BOOKING_CHANNELS }).notNull(),
    /** Identity user id of the actor who created the booking (null = guest). */
    createdBy: text("created_by"),
    note: text("note"),
    cancellationReason: text("cancellation_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Double-booking invariant (§3.4, ported from the old schema): at most
     * one slot-occupying appointment per doctor-location and start instant.
     * The in-tx conflict check gives the friendly typed error; this index
     * is the strongly-consistent backstop under concurrency.
     */
    uniqueIndex("appointments_active_slot_unique")
      .on(table.doctorLocationId, table.startsAt)
      .where(sql`${table.status} in ('booked', 'confirmed', 'checked_in', 'in_progress')`),
    index("appointments_doctor_location_starts_idx").on(table.doctorLocationId, table.startsAt),
    index("appointments_patient_profile_idx").on(table.patientProfileId, table.startsAt),
    check(
      "appointments_status_check",
      sql`${table.status} in ('booked', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show')`,
    ),
    check(
      "appointments_booked_via_check",
      sql`${table.bookedVia} in ('guest_web', 'patient_account', 'secretary_walk_in')`,
    ),
    check("appointments_window_check", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);
