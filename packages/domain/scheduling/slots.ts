/**
 * Locations module — pure slot generation logic
 * Module Owner: Locations Team
 *
 * Pure functions only (no DB, no session) so they are unit-testable.
 * Convention: appointments are stored as timestamptz (UTC instants);
 * weekly schedules are wall-clock times in the clinic timezone
 * (Asia/Baghdad). Generation expands wall-clock schedules into UTC
 * instants for a given date range.
 */

export const CLINIC_TIME_ZONE = "Asia/Baghdad";

export interface ScheduleBreakInput {
  /** "HH:MM" or "HH:MM:SS" wall-clock time */
  startTime: string;
  endTime: string;
}

export interface WeeklyScheduleInput {
  /** 0-6, Sunday = 0 (matches Postgres day_of_week convention in schema) */
  dayOfWeek: number;
  /** "HH:MM" or "HH:MM:SS" wall-clock time in the clinic timezone */
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  breaks: ScheduleBreakInput[];
}

export interface BlockedRange {
  /** UTC instant */
  startsAt: Date;
  endsAt: Date;
}

export interface Slot {
  /** UTC instant */
  startsAt: Date;
  endsAt: Date;
}

/** Minutes since midnight for a "HH:MM[:SS]" string. Seconds are ignored. */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Offset (ms) of `timeZone` relative to UTC at the given instant.
 * Uses Intl so DST/history rules are correct without a tz library.
 */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    parts[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // Intl can emit "24" for midnight
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/**
 * Convert wall-clock time in `timeZone` to a UTC instant.
 * Two-pass offset resolution handles DST transitions generically
 * (Asia/Baghdad has been fixed +03:00 since 2008, so one pass suffices there).
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  minutesSinceMidnight: number,
  timeZone: string,
): Date {
  const wallTicks = Date.UTC(year, month - 1, day, 0, minutesSinceMidnight);
  const offset1 = getTimeZoneOffsetMs(new Date(wallTicks), timeZone);
  let ts = wallTicks - offset1;
  const offset2 = getTimeZoneOffsetMs(new Date(ts), timeZone);
  if (offset2 !== offset1) {
    ts = wallTicks - offset2;
  }
  return new Date(ts);
}

/** Calendar date (in `timeZone`) that the instant falls on. */
export function getZoneCalendarDate(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.format(date).split("-");
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * UTC instants for the start and end (exclusive) of the calendar day, in
 * `timeZone`, that `instant` falls on. Used for "today's queue" queries.
 */
export function getDayRangeInZone(
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): { from: Date; to: Date } {
  const { year, month, day } = getZoneCalendarDate(instant, timeZone);
  const from = zonedTimeToUtc(year, month, day, 0, timeZone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const to = zonedTimeToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    timeZone,
  );
  return { from, to };
}

/**
 * Expand weekly schedules minus breaks minus blocked ranges into concrete
 * slots within [from, to]. Slots are aligned to the schedule start time at
 * slotDurationMinutes granularity; a slot is emitted only if it fits fully
 * inside the working window, does not overlap a break or blocked range, and
 * lies fully within [from, to].
 *
 * Booked-appointment exclusion is intentionally NOT done here — the
 * appointments module owns appointments and subtracts them at its layer.
 */
export function generateSlotsForRange(options: {
  schedules: WeeklyScheduleInput[];
  blocked: BlockedRange[];
  from: Date;
  to: Date;
  timeZone?: string;
}): Slot[] {
  const { schedules, blocked, from, to } = options;
  const timeZone = options.timeZone ?? CLINIC_TIME_ZONE;

  if (from >= to || schedules.length === 0) {
    return [];
  }

  const slots: Slot[] = [];

  // Walk calendar days (in the clinic timezone) covering [from, to].
  let cursor = getZoneCalendarDate(from, timeZone);
  const lastDay = getZoneCalendarDate(to, timeZone);

  const dayNumber = (d: { year: number; month: number; day: number }) =>
    d.year * 10000 + d.month * 100 + d.day;

  while (dayNumber(cursor) <= dayNumber(lastDay)) {
    // Weekday of a calendar date is timezone-independent once we have the
    // local calendar date; Date.UTC gives it without further conversion.
    const dayOfWeek = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day)).getUTCDay();

    for (const schedule of schedules) {
      if (schedule.dayOfWeek !== dayOfWeek) continue;
      if (schedule.slotDurationMinutes <= 0) continue;

      const workStart = parseTimeToMinutes(schedule.startTime);
      const workEnd = parseTimeToMinutes(schedule.endTime);
      const breaks = schedule.breaks.map((b) => ({
        start: parseTimeToMinutes(b.startTime),
        end: parseTimeToMinutes(b.endTime),
      }));

      for (
        let start = workStart;
        start + schedule.slotDurationMinutes <= workEnd;
        start += schedule.slotDurationMinutes
      ) {
        const end = start + schedule.slotDurationMinutes;

        if (breaks.some((b) => rangesOverlap(start, end, b.start, b.end))) {
          continue;
        }

        const startsAt = zonedTimeToUtc(cursor.year, cursor.month, cursor.day, start, timeZone);
        const endsAt = zonedTimeToUtc(cursor.year, cursor.month, cursor.day, end, timeZone);

        if (startsAt < from || endsAt > to) continue;

        if (
          blocked.some((b) =>
            rangesOverlap(
              startsAt.getTime(),
              endsAt.getTime(),
              b.startsAt.getTime(),
              b.endsAt.getTime(),
            ),
          )
        ) {
          continue;
        }

        slots.push({ startsAt, endsAt });
      }
    }

    // Advance one calendar day (exact in UTC calendar arithmetic).
    const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day + 1));
    cursor = {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
    };
  }

  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  // Dedupe identical starts: weekly_schedules has no unique constraint on
  // (doctor, location, day), so duplicate schedule rows are representable
  // state and must not surface as duplicate bookable slots.
  const seen = new Set<number>();
  return slots.filter((slot) => {
    const key = slot.startsAt.getTime();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
