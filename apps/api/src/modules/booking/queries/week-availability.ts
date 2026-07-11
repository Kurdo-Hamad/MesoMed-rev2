/**
 * Public week availability: the scheduling module's published inputs
 * expanded by the ported domain slot engine, minus this module's own
 * active appointments. Read-only; eventual consistency is irrelevant
 * because the booking command re-validates in its transaction (§3.4).
 */
import type { z } from "zod";
import type { weekAvailabilityOutputSchema } from "@mesomed/contracts/booking";
import { ErrorCode } from "@mesomed/contracts/errors";
import { ACTIVE_APPOINTMENT_STATUSES, subtractBusyIntervals } from "@mesomed/domain/booking";
import {
  buildWeekDays,
  generateSlotsForRange,
  getWeekRangeInZone,
} from "@mesomed/domain/scheduling";
import { and, appointments, eq, gt, inArray, lt, type DbExecutor } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import { getDoctorLocation, getScheduleInputs } from "../../scheduling/queries/schedule-inputs.js";

export type WeekAvailabilityOutput = z.output<typeof weekAvailabilityOutputSchema>;

export async function getWeekAvailability(
  db: DbExecutor,
  input: { doctorLocationId: string; anchor?: string | undefined; now?: Date },
): Promise<WeekAvailabilityOutput> {
  const doctorLocation = await getDoctorLocation(db, input.doctorLocationId);
  if (!doctorLocation) throw new AppError(ErrorCode.NOT_FOUND, "Doctor location not found");

  const now = input.now ?? new Date();
  const anchor = input.anchor ? new Date(input.anchor) : now;
  const week = getWeekRangeInZone(anchor, doctorLocation.timeZone);

  const inputs = await getScheduleInputs(db, input.doctorLocationId, week);
  const slots = doctorLocation.bookable
    ? generateSlotsForRange({
        schedules: inputs.schedules,
        blocked: inputs.blocked,
        from: week.from,
        to: week.to,
        timeZone: doctorLocation.timeZone,
      })
    : [];

  const busy = await db
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.doctorLocationId, input.doctorLocationId),
        inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        lt(appointments.startsAt, week.to),
        gt(appointments.endsAt, week.from),
      ),
    );

  const open = subtractBusyIntervals(slots, busy);
  const days = buildWeekDays({
    anchor,
    scheduledWeekdays: inputs.scheduledWeekdays,
    slots: open,
    now,
    timeZone: doctorLocation.timeZone,
  });

  return {
    doctorLocationId: input.doctorLocationId,
    timeZone: doctorLocation.timeZone,
    days: days.map((day) => ({
      date: day.date,
      dayOfWeek: day.dayOfWeek,
      isOpen: day.isOpen,
      isToday: day.isToday,
      isPast: day.isPast,
      slots: day.slots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      })),
    })),
  };
}
