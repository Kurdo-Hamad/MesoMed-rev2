import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Scheduling module tables (MM-PLAN-001 §5 Phase 4) — owned exclusively by
 * `apps/api/src/modules/scheduling` (§3.1). Cross-module references
 * (directory doctor profiles/cities, identity users) are stored as plain
 * ids without FK constraints, the same precedent as
 * `providers.identityProfileId` (ADR-0005): referential integrity across
 * module boundaries is the owning module's application-level concern, not
 * a schema coupling.
 *
 * Time model (ported domain convention, packages/domain/scheduling):
 * weekly schedules and breaks are wall-clock times in the clinic timezone
 * (Asia/Baghdad canonical); blocked slots and appointments are timestamptz
 * UTC instants. Slot generation expands wall-clock to UTC per date.
 */

export const practiceLocations = pgTable(
  "practice_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    /** Directory city id (cross-module reference, no FK — see header). */
    cityId: uuid("city_id"),
    addressEn: text("address_en"),
    addressAr: text("address_ar"),
    addressCkb: text("address_ckb"),
    phone: text("phone"),
    /** IANA timezone for wall-clock schedule expansion. */
    timeZone: text("time_zone").notNull().default("Asia/Baghdad"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("practice_locations_slug_unique").on(table.slug)],
);

/**
 * A doctor practising at a location — the aggregate the booking module
 * books against. `doctorProfileId` is the directory module's doctor
 * profile id (cross-module reference, no FK).
 */
export const doctorLocations = pgTable(
  "doctor_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorProfileId: uuid("doctor_profile_id").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => practiceLocations.id),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("doctor_locations_doctor_location_unique").on(
      table.doctorProfileId,
      table.locationId,
    ),
    index("doctor_locations_location_id_idx").on(table.locationId),
  ],
);

/**
 * Secretary assignments (MM-PLAN-001 §5 Phase 4): which identity users with
 * the secretary role may operate a doctor-location's front desk (walk-in
 * booking, confirm, check-in, no-show). `secretaryUserId` is the identity
 * module's user id (cross-module reference, no FK).
 */
export const secretaryAssignments = pgTable(
  "secretary_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    secretaryUserId: text("secretary_user_id").notNull(),
    doctorLocationId: uuid("doctor_location_id")
      .notNull()
      .references(() => doctorLocations.id),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("secretary_assignments_unique").on(table.secretaryUserId, table.doctorLocationId),
    index("secretary_assignments_doctor_location_idx").on(table.doctorLocationId),
  ],
);

/**
 * Weekly working windows. Wholesale-replaced per doctor-location by the
 * setWeeklySchedule command (the input is the full truth — same
 * determinism discipline as facility media/sections in Phase 3).
 */
export const weeklySchedules = pgTable(
  "weekly_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorLocationId: uuid("doctor_location_id")
      .notNull()
      .references(() => doctorLocations.id, { onDelete: "cascade" }),
    /** 0-6, Sunday = 0 (Postgres day_of_week convention; domain contract). */
    dayOfWeek: integer("day_of_week").notNull(),
    /** Wall-clock time in the location timezone. */
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    slotDurationMinutes: integer("slot_duration_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("weekly_schedules_doctor_location_idx").on(table.doctorLocationId, table.dayOfWeek),
    check("weekly_schedules_day_of_week_check", sql`${table.dayOfWeek} between 0 and 6`),
    check("weekly_schedules_duration_check", sql`${table.slotDurationMinutes} > 0`),
    check("weekly_schedules_window_check", sql`${table.startTime} < ${table.endTime}`),
  ],
);

export const scheduleBreaks = pgTable(
  "schedule_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weeklyScheduleId: uuid("weekly_schedule_id")
      .notNull()
      .references(() => weeklySchedules.id, { onDelete: "cascade" }),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (table) => [
    index("schedule_breaks_schedule_idx").on(table.weeklyScheduleId),
    check("schedule_breaks_window_check", sql`${table.startTime} < ${table.endTime}`),
  ],
);

/** Ad-hoc unavailability as UTC instants (vacation day, conference, …). */
export const blockedSlots = pgTable(
  "blocked_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorLocationId: uuid("doctor_location_id")
      .notNull()
      .references(() => doctorLocations.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("blocked_slots_doctor_location_idx").on(table.doctorLocationId, table.startsAt),
    check("blocked_slots_window_check", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);
