/**
 * Wholesale-replaces a doctor-location's weekly schedule (the input array
 * is the full truth — deterministic under re-runs, same discipline as
 * facility media/sections in Phase 3). Breaks must fall inside their
 * window; windows must fit at least one slot.
 */
import type { z } from "zod";
import type { setWeeklyScheduleInputSchema } from "@mesomed/contracts/scheduling";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  doctorLocations,
  eq,
  inArray,
  scheduleBreaks,
  weeklySchedules,
  type DbTransaction,
} from "@mesomed/db/modules/scheduling";
import { AppError } from "../../../kernel/errors.js";

export type SetWeeklyScheduleInput = z.output<typeof setWeeklyScheduleInputSchema>;

function minutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

export async function setWeeklySchedule(
  tx: DbTransaction,
  input: SetWeeklyScheduleInput,
): Promise<{ doctorLocationId: string; scheduleCount: number }> {
  const [doctorLocation] = await tx
    .select({ id: doctorLocations.id })
    .from(doctorLocations)
    .where(eq(doctorLocations.id, input.doctorLocationId))
    .for("update");
  if (!doctorLocation) throw new AppError(ErrorCode.NOT_FOUND, "Doctor location not found");

  for (const entry of input.schedules) {
    const start = minutes(entry.startTime);
    const end = minutes(entry.endTime);
    if (start + entry.slotDurationMinutes > end) {
      throw new AppError(
        ErrorCode.VALIDATION,
        `Schedule window ${entry.startTime}-${entry.endTime} does not fit one ${entry.slotDurationMinutes}-minute slot`,
      );
    }
    for (const brk of entry.breaks) {
      if (minutes(brk.startTime) >= minutes(brk.endTime)) {
        throw new AppError(ErrorCode.VALIDATION, "Break start must precede break end");
      }
      if (minutes(brk.startTime) < start || minutes(brk.endTime) > end) {
        throw new AppError(ErrorCode.VALIDATION, "Break must fall inside the schedule window");
      }
    }
  }

  const existingIds = (
    await tx
      .select({ id: weeklySchedules.id })
      .from(weeklySchedules)
      .where(eq(weeklySchedules.doctorLocationId, input.doctorLocationId))
  ).map((row) => row.id);
  if (existingIds.length > 0) {
    // Breaks cascade on schedule delete, but an explicit delete keeps the
    // replacement independent of FK cascade configuration.
    await tx.delete(scheduleBreaks).where(inArray(scheduleBreaks.weeklyScheduleId, existingIds));
    await tx.delete(weeklySchedules).where(inArray(weeklySchedules.id, existingIds));
  }

  for (const entry of input.schedules) {
    const [inserted] = await tx
      .insert(weeklySchedules)
      .values({
        doctorLocationId: input.doctorLocationId,
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        slotDurationMinutes: entry.slotDurationMinutes,
      })
      .returning({ id: weeklySchedules.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Schedule insert returned no row");
    if (entry.breaks.length > 0) {
      await tx.insert(scheduleBreaks).values(
        entry.breaks.map((brk) => ({
          weeklyScheduleId: inserted.id,
          startTime: brk.startTime,
          endTime: brk.endTime,
        })),
      );
    }
  }

  return { doctorLocationId: input.doctorLocationId, scheduleCount: input.schedules.length };
}
