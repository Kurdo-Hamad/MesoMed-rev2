/**
 * Scheduling module API contracts (MM-PLAN-001 §5 Phase 4). Router I/O is
 * typed here so web/mobile share one source of truth (§3.11/§3.12).
 *
 * Weekly schedules and breaks are wall-clock "HH:MM" times in the
 * location's timezone (Asia/Baghdad canonical); blocked slots are UTC
 * instants — the same time model as the ported slot-generation domain
 * code in `packages/domain/scheduling`.
 */
import { z } from "zod";
import { localizedTextSchema } from "./events/directory.js";

/** Wall-clock "HH:MM" or "HH:MM:SS" (seconds accepted, ignored). */
export const wallClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
  message: "Expected wall-clock time as HH:MM",
});

export const upsertLocationInputSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/),
  name: localizedTextSchema,
  address: localizedTextSchema.optional(),
  phone: z.string().max(30).optional(),
  /** IANA timezone; the platform launch canon is Asia/Baghdad. */
  timeZone: z.string().min(1).max(64).default("Asia/Baghdad"),
  active: z.boolean().default(true),
});

export const upsertLocationResultSchema = z.object({
  id: z.string(),
  created: z.boolean(),
});

export const linkDoctorLocationInputSchema = z.object({
  doctorProfileId: z.string().uuid(),
  locationId: z.string().uuid(),
  active: z.boolean().default(true),
});

export const linkDoctorLocationResultSchema = z.object({
  doctorLocationId: z.string(),
  created: z.boolean(),
});

export const assignSecretaryInputSchema = z.object({
  secretaryUserId: z.string().min(1).max(200),
  doctorLocationId: z.string().uuid(),
  active: z.boolean().default(true),
});

export const assignSecretaryResultSchema = z.object({
  assignmentId: z.string(),
});

const scheduleBreakSchema = z.object({
  startTime: wallClockTimeSchema,
  endTime: wallClockTimeSchema,
});

const weeklyScheduleEntrySchema = z.object({
  /** 0-6, Sunday = 0 (Postgres day_of_week convention). */
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: wallClockTimeSchema,
  endTime: wallClockTimeSchema,
  slotDurationMinutes: z.number().int().min(5).max(240),
  breaks: z.array(scheduleBreakSchema).max(10).default([]),
});

/** Wholesale replacement: the array is the doctor-location's full truth. */
export const setWeeklyScheduleInputSchema = z.object({
  doctorLocationId: z.string().uuid(),
  schedules: z.array(weeklyScheduleEntrySchema).max(21),
});

export const setWeeklyScheduleResultSchema = z.object({
  doctorLocationId: z.string(),
  scheduleCount: z.number().int(),
});

export const blockSlotInputSchema = z.object({
  doctorLocationId: z.string().uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string().max(500).optional(),
});

export const blockSlotResultSchema = z.object({ id: z.string() });

export const removeBlockedSlotInputSchema = z.object({
  doctorLocationId: z.string().uuid(),
  blockedSlotId: z.string().uuid(),
});

export const removeBlockedSlotResultSchema = z.object({ removed: z.boolean() });

export const listDoctorLocationsInputSchema = z.object({
  doctorProfileId: z.string().uuid(),
});

export const doctorLocationItemSchema = z.object({
  doctorLocationId: z.string(),
  locationId: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  address: localizedTextSchema.nullable(),
  phone: z.string().nullable(),
  timeZone: z.string(),
  active: z.boolean(),
});

export const listDoctorLocationsOutputSchema = z.object({
  locations: z.array(doctorLocationItemSchema),
});

// ── Clinic-side workplaces (Phase 8 dashboards) ────────────────────────

/**
 * A doctor-location the session works at: own practice rows for doctors,
 * active assignments for secretaries. Admin uses directory browse instead.
 */
export const myWorkplaceItemSchema = doctorLocationItemSchema.extend({
  doctorProfileId: z.string(),
  /** How the session relates to this workplace. */
  relation: z.enum(["owning_doctor", "assigned_secretary"]),
});

export const myWorkplacesOutputSchema = z.object({
  workplaces: z.array(myWorkplaceItemSchema),
});
