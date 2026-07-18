/**
 * Published scheduling reads (§3.1): the booking module composes these to
 * generate/validate slots and to run its layer-b access checks — it never
 * touches scheduling tables directly.
 */
import type { BlockedRange, WeeklyScheduleInput } from "@mesomed/domain/scheduling";
import {
  and,
  blockedSlots,
  doctorLocations,
  eq,
  gte,
  lte,
  practiceLocations,
  scheduleBreaks,
  secretaryAssignments,
  weeklySchedules,
  type DbExecutor,
} from "@mesomed/db/modules/scheduling";

export interface DoctorLocationRef {
  doctorLocationId: string;
  doctorProfileId: string;
  locationId: string;
  active: boolean;
  /** Location active flag AND'd in — an inactive location books nothing. */
  bookable: boolean;
  timeZone: string;
}

/** The doctor-location row with its location's timezone, or null. */
export async function getDoctorLocation(
  db: DbExecutor,
  doctorLocationId: string,
): Promise<DoctorLocationRef | null> {
  const [row] = await db
    .select({
      doctorLocationId: doctorLocations.id,
      doctorProfileId: doctorLocations.doctorProfileId,
      locationId: doctorLocations.locationId,
      active: doctorLocations.active,
      locationActive: practiceLocations.active,
      timeZone: practiceLocations.timeZone,
    })
    .from(doctorLocations)
    .innerJoin(practiceLocations, eq(practiceLocations.id, doctorLocations.locationId))
    .where(eq(doctorLocations.id, doctorLocationId))
    .limit(1);
  if (!row) return null;
  return {
    doctorLocationId: row.doctorLocationId,
    doctorProfileId: row.doctorProfileId,
    locationId: row.locationId,
    active: row.active,
    bookable: row.active && row.locationActive,
    timeZone: row.timeZone,
  };
}

export interface ScheduleInputs {
  schedules: WeeklyScheduleInput[];
  scheduledWeekdays: ReadonlySet<number>;
  blocked: BlockedRange[];
}

/**
 * Weekly schedules (with breaks) and the blocked ranges intersecting
 * [from, to] for a doctor-location — the exact inputs of the ported
 * `generateSlotsForRange` domain function.
 */
export async function getScheduleInputs(
  db: DbExecutor,
  doctorLocationId: string,
  range: { from: Date; to: Date },
): Promise<ScheduleInputs> {
  const scheduleRows = await db
    .select({
      id: weeklySchedules.id,
      dayOfWeek: weeklySchedules.dayOfWeek,
      startTime: weeklySchedules.startTime,
      endTime: weeklySchedules.endTime,
      slotDurationMinutes: weeklySchedules.slotDurationMinutes,
    })
    .from(weeklySchedules)
    .where(eq(weeklySchedules.doctorLocationId, doctorLocationId));

  const breakRows =
    scheduleRows.length === 0
      ? []
      : await db
          .select({
            weeklyScheduleId: scheduleBreaks.weeklyScheduleId,
            startTime: scheduleBreaks.startTime,
            endTime: scheduleBreaks.endTime,
          })
          .from(scheduleBreaks)
          .innerJoin(weeklySchedules, eq(weeklySchedules.id, scheduleBreaks.weeklyScheduleId))
          .where(eq(weeklySchedules.doctorLocationId, doctorLocationId));

  const breaksBySchedule = new Map<string, { startTime: string; endTime: string }[]>();
  for (const row of breakRows) {
    const list = breaksBySchedule.get(row.weeklyScheduleId) ?? [];
    list.push({ startTime: row.startTime, endTime: row.endTime });
    breaksBySchedule.set(row.weeklyScheduleId, list);
  }

  const blockedRows = await db
    .select({ startsAt: blockedSlots.startsAt, endsAt: blockedSlots.endsAt })
    .from(blockedSlots)
    .where(
      and(
        eq(blockedSlots.doctorLocationId, doctorLocationId),
        lte(blockedSlots.startsAt, range.to),
        gte(blockedSlots.endsAt, range.from),
      ),
    );

  const schedules = scheduleRows.map((row) => ({
    dayOfWeek: row.dayOfWeek,
    startTime: row.startTime,
    endTime: row.endTime,
    slotDurationMinutes: row.slotDurationMinutes,
    breaks: breaksBySchedule.get(row.id) ?? [],
  }));

  return {
    schedules,
    scheduledWeekdays: new Set(schedules.map((s) => s.dayOfWeek)),
    blocked: blockedRows,
  };
}

/** Active-assignment check backing secretary layer-b authorization. */
export async function isSecretaryAssigned(
  db: DbExecutor,
  secretaryUserId: string,
  doctorLocationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: secretaryAssignments.id })
    .from(secretaryAssignments)
    .where(
      and(
        eq(secretaryAssignments.secretaryUserId, secretaryUserId),
        eq(secretaryAssignments.doctorLocationId, doctorLocationId),
        eq(secretaryAssignments.active, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}
