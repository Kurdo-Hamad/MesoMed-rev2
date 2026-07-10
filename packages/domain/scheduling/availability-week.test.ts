/**
 * Appointments module — week availability grouping unit tests
 * Module Owner: Appointments Team
 */

import { describe, it, expect } from 'vitest';
import type { Slot } from '@/modules/locations/slots';
import {
  buildWeekDays,
  getWeekRangeInZone,
  WEEK_STARTS_ON,
} from './availability-week';

// Baghdad is UTC+3 year-round (no DST since 2008).
// 2026-07-04 is a Saturday; 2026-07-06 is a Monday.
function baghdadInstant(
  day: number,
  hour: number,
  minute = 0,
  month = 7,
  year = 2026
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute));
}

function slotAt(day: number, hour: number, minute = 0, month = 7): Slot {
  const startsAt = baghdadInstant(day, hour, minute, month);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000) };
}

describe('getWeekRangeInZone', () => {
  it('snaps any instant to the Saturday-start clinic week', () => {
    expect(WEEK_STARTS_ON).toBe(6); // Saturday — Iraq calendar convention

    // Monday 15:00 Baghdad → week is Sat 2026-07-04 .. Fri 2026-07-10.
    const range = getWeekRangeInZone(baghdadInstant(6, 15));
    expect(range.from.toISOString()).toBe('2026-07-03T21:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-07-10T21:00:00.000Z');
  });

  it('keeps an instant exactly at week start in the same week', () => {
    const range = getWeekRangeInZone(baghdadInstant(4, 0));
    expect(range.from.toISOString()).toBe('2026-07-03T21:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-07-10T21:00:00.000Z');
  });

  it('spans month boundaries', () => {
    // Wednesday 2026-07-01 → week starts Saturday 2026-06-27.
    const range = getWeekRangeInZone(baghdadInstant(1, 10));
    expect(range.from.toISOString()).toBe('2026-06-26T21:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-07-03T21:00:00.000Z');
  });
});

describe('buildWeekDays', () => {
  // "Now" is Monday 2026-07-06 10:00 Baghdad for most tests.
  const NOW = baghdadInstant(6, 10);

  it('returns 7 days from Saturday with clinic-timezone dates and weekdays', () => {
    const days = buildWeekDays({
      anchor: NOW,
      scheduledWeekdays: new Set(),
      slots: [],
      now: NOW,
    });

    expect(days).toHaveLength(7);
    expect(days.map((d) => d.date)).toEqual([
      '2026-07-04',
      '2026-07-05',
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
    ]);
    expect(days.map((d) => d.dayOfWeek)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it('marks days open only when the weekday has a schedule', () => {
    const days = buildWeekDays({
      anchor: NOW,
      scheduledWeekdays: new Set([1, 3]), // Monday, Wednesday
      slots: [],
      now: NOW,
    });

    expect(days.map((d) => d.isOpen)).toEqual([
      false, // Sat
      false, // Sun
      true, // Mon
      false, // Tue
      true, // Wed
      false, // Thu
      false, // Fri
    ]);
  });

  it('groups slots into their clinic-timezone calendar day', () => {
    const monday = slotAt(6, 11);
    const wednesday = slotAt(8, 9);
    const days = buildWeekDays({
      anchor: NOW,
      scheduledWeekdays: new Set([1, 3]),
      slots: [monday, wednesday],
      now: NOW,
    });

    expect(days[2].slots).toEqual([monday]);
    expect(days[4].slots).toEqual([wednesday]);
    expect(days.flatMap((d) => d.slots)).toHaveLength(2);
  });

  it('drops past slots for today and everything on past days', () => {
    const days = buildWeekDays({
      anchor: NOW,
      scheduledWeekdays: new Set([0, 1]),
      // Sunday (already past), Monday 09:00 (past), Monday 11:00 (future).
      slots: [slotAt(5, 9), slotAt(6, 9), slotAt(6, 11)],
      now: NOW, // Monday 10:00
    });

    expect(days[1].slots).toEqual([]); // Sunday emptied
    expect(days[2].slots.map((s) => s.startsAt.toISOString())).toEqual([
      baghdadInstant(6, 11).toISOString(),
    ]);
  });

  it('flags today and past days relative to now in the clinic timezone', () => {
    const days = buildWeekDays({
      anchor: NOW,
      scheduledWeekdays: new Set(),
      slots: [],
      now: NOW, // Monday
    });

    expect(days.map((d) => d.isToday)).toEqual([
      false,
      false,
      true, // Monday
      false,
      false,
      false,
      false,
    ]);
    expect(days.map((d) => d.isPast)).toEqual([
      true, // Sat
      true, // Sun
      false, // Mon (today)
      false,
      false,
      false,
      false,
    ]);
  });

  it('handles a future week (nothing past, nothing today)', () => {
    const nextWeekAnchor = baghdadInstant(13, 12); // Monday next week
    const days = buildWeekDays({
      anchor: nextWeekAnchor,
      scheduledWeekdays: new Set([1]),
      slots: [slotAt(13, 9)],
      now: NOW,
    });

    expect(days[0].date).toBe('2026-07-11');
    expect(days.every((d) => !d.isToday && !d.isPast)).toBe(true);
    expect(days[2].slots).toHaveLength(1);
  });
});
