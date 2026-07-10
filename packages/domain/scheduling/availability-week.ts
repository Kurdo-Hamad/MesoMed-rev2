/**
 * Appointments module — pure week-availability grouping
 * Module Owner: Appointments Team
 *
 * Pure functions only (no DB, no session) so they are unit-testable.
 * Groups open slots (already minus breaks/blocked/appointments) into the
 * seven clinic-timezone calendar days of the week containing an anchor
 * instant. Powers the weekly booking calendar.
 */

import {
  CLINIC_TIME_ZONE,
  getZoneCalendarDate,
  zonedTimeToUtc,
  type Slot,
} from './slots.js';

/** First day of the clinic week: Saturday (Iraq calendar convention). */
export const WEEK_STARTS_ON = 6;

export interface DaySummary {
  /** YYYY-MM-DD calendar date in the clinic timezone. */
  date: string;
  /** 0-6, Sunday = 0 (matches weekly_schedules.day_of_week). */
  dayOfWeek: number;
  /** The clinic has at least one weekly schedule on this weekday. */
  isOpen: boolean;
  isToday: boolean;
  /** The whole day is before `now` (clinic timezone). */
  isPast: boolean;
  /** Open slots that start on this day, past ones already dropped. */
  slots: Slot[];
}

export interface SerializedWeekSlot {
  startsAt: string; // ISO
  endsAt: string;
  /** e.g. "09:30 AM" — for the slot chip. */
  timeLabel: string;
  /** e.g. "Sunday, July 5 at 09:30 AM" — for selections/summaries. */
  dateTimeLabel: string;
}

/**
 * `DaySummary` with wire-safe ISO instants and display labels.
 * Labels are formatted on the SERVER on purpose: Node ships full ICU for
 * all app locales (incl. ckb) while browsers may silently fall back to
 * English, which breaks hydration when a client re-formats SSR'd dates.
 */
export interface SerializedDaySummary {
  date: string;
  isOpen: boolean;
  isToday: boolean;
  isPast: boolean;
  /** e.g. "Sun" */
  weekdayLabel: string;
  /** e.g. "5" (locale numerals) */
  dayLabel: string;
  /** e.g. "Jul 5" — for the week-range header. */
  monthDayLabel: string;
  /** e.g. "Sunday, July 5" — accessible name / selected-day heading. */
  fullLabel: string;
  /** Translated "N available" (empty when no slots) — see label note above. */
  availableCountLabel: string;
  slots: SerializedWeekSlot[];
}

/** Full date + time label for one slot instant (shared with /book). */
export function formatSlotDateTimeLabel(
  startsAt: Date,
  locale: string
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: CLINIC_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(startsAt);
}

export function serializeWeekDays(
  days: DaySummary[],
  locale: string,
  /** Translated count message, e.g. next-intl `t('availableCount', {count})`. */
  formatAvailableCount: (count: number) => string
): SerializedDaySummary[] {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: CLINIC_TIME_ZONE,
      ...options,
    });
  const weekday = part({ weekday: 'short' });
  const dayNumber = part({ day: 'numeric' });
  const monthDay = part({ day: 'numeric', month: 'short' });
  const full = part({ weekday: 'long', day: 'numeric', month: 'long' });
  const time = part({ hour: '2-digit', minute: '2-digit' });

  return days.map((d) => {
    // Noon UTC of a clinic-tz date is unambiguously within that day.
    const date = new Date(`${d.date}T12:00:00.000Z`);
    return {
      date: d.date,
      isOpen: d.isOpen,
      isToday: d.isToday,
      isPast: d.isPast,
      weekdayLabel: weekday.format(date),
      dayLabel: dayNumber.format(date),
      monthDayLabel: monthDay.format(date),
      fullLabel: full.format(date),
      availableCountLabel:
        d.slots.length > 0 ? formatAvailableCount(d.slots.length) : '',
      slots: d.slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        timeLabel: time.format(s.startsAt),
        dateTimeLabel: formatSlotDateTimeLabel(s.startsAt, locale),
      })),
    };
  });
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Weekday (0-6, Sunday = 0) of a calendar date, timezone-independent. */
function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function toISODate(date: CalendarDate): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** Clinic-timezone calendar date of the first day of the week containing `instant`. */
function weekStartDate(
  instant: Date,
  timeZone: string,
  weekStartsOn: number
): CalendarDate {
  const date = getZoneCalendarDate(instant, timeZone);
  const back = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDays(date, -back);
}

/**
 * UTC instants for the start and end (exclusive) of the clinic week that
 * `instant` falls in. Use as the range for slot generation.
 */
export function getWeekRangeInZone(
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
  weekStartsOn: number = WEEK_STARTS_ON
): { from: Date; to: Date } {
  const start = weekStartDate(instant, timeZone, weekStartsOn);
  const end = addDays(start, 7);
  return {
    from: zonedTimeToUtc(start.year, start.month, start.day, 0, timeZone),
    to: zonedTimeToUtc(end.year, end.month, end.day, 0, timeZone),
  };
}

/**
 * The seven day summaries of the week containing `anchor`. Slots that
 * start at or before `now` are dropped, so today never offers past times
 * and past days always show empty.
 */
export function buildWeekDays(options: {
  /** Any instant within the desired week. */
  anchor: Date;
  /** Weekdays (0-6, Sunday = 0) that have at least one weekly schedule. */
  scheduledWeekdays: ReadonlySet<number>;
  /** Open slots within the week (schedule minus breaks/blocked/appointments). */
  slots: Slot[];
  /** Current instant. */
  now: Date;
  timeZone?: string;
  weekStartsOn?: number;
}): DaySummary[] {
  const { anchor, scheduledWeekdays, slots, now } = options;
  const timeZone = options.timeZone ?? CLINIC_TIME_ZONE;
  const weekStartsOn = options.weekStartsOn ?? WEEK_STARTS_ON;

  const start = weekStartDate(anchor, timeZone, weekStartsOn);
  const todayISO = toISODate(getZoneCalendarDate(now, timeZone));

  const days: DaySummary[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const next = addDays(date, 1);
    const dayFrom = zonedTimeToUtc(date.year, date.month, date.day, 0, timeZone);
    const dayTo = zonedTimeToUtc(next.year, next.month, next.day, 0, timeZone);

    days.push({
      date: toISODate(date),
      dayOfWeek: weekdayOf(date),
      isOpen: scheduledWeekdays.has(weekdayOf(date)),
      isToday: toISODate(date) === todayISO,
      isPast: dayTo.getTime() <= now.getTime(),
      slots: slots.filter(
        (s) => s.startsAt >= dayFrom && s.startsAt < dayTo && s.startsAt > now
      ),
    });
  }
  return days;
}
