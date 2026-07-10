/**
 * Locations module — slot generation unit tests
 * Module Owner: Locations Team
 */

import { describe, it, expect } from "vitest";
import { generateSlotsForRange, type WeeklyScheduleInput } from "./slots.js";

// Monday 2026-07-06 in Asia/Baghdad (UTC+3, no DST since 2008).
// 00:00 Baghdad == 21:00 UTC the previous day.
const MONDAY = { year: 2026, month: 7, day: 6 };

function baghdadInstant(
  day: number,
  hour: number,
  minute = 0,
  month = MONDAY.month,
  year = MONDAY.year,
): Date {
  // Baghdad is UTC+3 year-round.
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute));
}

function mondaySchedule(overrides: Partial<WeeklyScheduleInput> = {}): WeeklyScheduleInput {
  return {
    dayOfWeek: 1, // Monday
    startTime: "09:00",
    endTime: "12:00",
    slotDurationMinutes: 30,
    breaks: [],
    ...overrides,
  };
}

// Full Monday window in Baghdad time.
const FROM = baghdadInstant(MONDAY.day, 0);
const TO = baghdadInstant(MONDAY.day + 1, 0);

describe("generateSlotsForRange", () => {
  it("expands a schedule into duration-sized slots in UTC", () => {
    const slots = generateSlotsForRange({
      schedules: [mondaySchedule()],
      blocked: [],
      from: FROM,
      to: TO,
    });

    expect(slots).toHaveLength(6); // 09:00-12:00 / 30min
    // 09:00 Asia/Baghdad == 06:00 UTC
    expect(slots[0]!.startsAt.toISOString()).toBe("2026-07-06T06:00:00.000Z");
    expect(slots[0]!.endsAt.toISOString()).toBe("2026-07-06T06:30:00.000Z");
    expect(slots[5]!.startsAt.toISOString()).toBe("2026-07-06T08:30:00.000Z");
    expect(slots[5]!.endsAt.toISOString()).toBe("2026-07-06T09:00:00.000Z");
  });

  it("accepts HH:MM:SS time strings (Postgres time column format)", () => {
    const slots = generateSlotsForRange({
      schedules: [mondaySchedule({ startTime: "09:00:00", endTime: "10:00:00" })],
      blocked: [],
      from: FROM,
      to: TO,
    });
    expect(slots).toHaveLength(2);
  });

  it("excludes slots overlapping breaks, keeping boundary-adjacent slots", () => {
    const slots = generateSlotsForRange({
      schedules: [
        mondaySchedule({
          breaks: [{ startTime: "10:00", endTime: "10:30" }],
        }),
      ],
      blocked: [],
      from: FROM,
      to: TO,
    });

    const starts = slots.map((s) => s.startsAt.toISOString());
    // 10:00 Baghdad slot (07:00 UTC) removed; 09:30 (ends 10:00) and 10:30 kept.
    expect(starts).not.toContain("2026-07-06T07:00:00.000Z");
    expect(starts).toContain("2026-07-06T06:30:00.000Z");
    expect(starts).toContain("2026-07-06T07:30:00.000Z");
    expect(slots).toHaveLength(5);
  });

  it("excludes a slot partially covered by a break", () => {
    const slots = generateSlotsForRange({
      schedules: [
        mondaySchedule({
          breaks: [{ startTime: "10:15", endTime: "10:20" }],
        }),
      ],
      blocked: [],
      from: FROM,
      to: TO,
    });
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).not.toContain("2026-07-06T07:00:00.000Z"); // 10:00-10:30 Baghdad
    expect(slots).toHaveLength(5);
  });

  it("excludes slots overlapping blocked ranges (UTC comparison)", () => {
    const slots = generateSlotsForRange({
      schedules: [mondaySchedule()],
      blocked: [
        {
          startsAt: baghdadInstant(MONDAY.day, 11),
          endsAt: baghdadInstant(MONDAY.day, 12),
        },
      ],
      from: FROM,
      to: TO,
    });

    expect(slots).toHaveLength(4); // 11:00 and 11:30 Baghdad slots removed
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).not.toContain("2026-07-06T08:00:00.000Z");
    expect(starts).not.toContain("2026-07-06T08:30:00.000Z");
  });

  it("drops a trailing slot that does not fit before the end of the window", () => {
    const slots = generateSlotsForRange({
      schedules: [mondaySchedule({ startTime: "09:00", endTime: "10:50" })],
      blocked: [],
      from: FROM,
      to: TO,
    });
    // 09:00, 09:30, 10:00 fit; 10:30-11:00 exceeds 10:50.
    expect(slots).toHaveLength(3);
    expect(slots[2]!.endsAt.toISOString()).toBe("2026-07-06T07:30:00.000Z");
  });

  it("clips slots to the requested [from, to] range", () => {
    const slots = generateSlotsForRange({
      schedules: [mondaySchedule()],
      blocked: [],
      from: baghdadInstant(MONDAY.day, 10), // 10:00 Baghdad
      to: baghdadInstant(MONDAY.day, 11, 30),
    });
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).toEqual([
      "2026-07-06T07:00:00.000Z", // 10:00 Baghdad
      "2026-07-06T07:30:00.000Z",
      "2026-07-06T08:00:00.000Z", // 11:00-11:30 ends exactly at `to`
    ]);
  });

  it("spans multiple days and schedules, sorted by start", () => {
    const slots = generateSlotsForRange({
      schedules: [
        mondaySchedule({ startTime: "09:00", endTime: "10:00" }),
        // Tuesday afternoon
        mondaySchedule({ dayOfWeek: 2, startTime: "14:00", endTime: "15:00" }),
      ],
      blocked: [],
      from: FROM,
      to: baghdadInstant(MONDAY.day + 2, 0),
    });

    expect(slots).toHaveLength(4);
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).toEqual([
      "2026-07-06T06:00:00.000Z",
      "2026-07-06T06:30:00.000Z",
      "2026-07-07T11:00:00.000Z", // Tue 14:00 Baghdad
      "2026-07-07T11:30:00.000Z",
    ]);
  });

  it("returns nothing when no schedule matches the day of week", () => {
    const slots = generateSlotsForRange({
      schedules: [mondaySchedule({ dayOfWeek: 5 })], // Friday
      blocked: [],
      from: FROM,
      to: TO, // Monday only
    });
    expect(slots).toEqual([]);
  });

  it("returns nothing for empty schedules or inverted range", () => {
    expect(generateSlotsForRange({ schedules: [], blocked: [], from: FROM, to: TO })).toEqual([]);
    expect(
      generateSlotsForRange({
        schedules: [mondaySchedule()],
        blocked: [],
        from: TO,
        to: FROM,
      }),
    ).toEqual([]);
  });

  it("ignores non-positive slot durations instead of looping forever", () => {
    const slots = generateSlotsForRange({
      schedules: [mondaySchedule({ slotDurationMinutes: 0 })],
      blocked: [],
      from: FROM,
      to: TO,
    });
    expect(slots).toEqual([]);
  });

  it("handles day boundaries: a Baghdad evening slot lands on the same local day", () => {
    // 23:00-23:59 Baghdad Monday == 20:00-20:59 UTC Monday
    const slots = generateSlotsForRange({
      schedules: [
        mondaySchedule({ startTime: "23:00", endTime: "23:40", slotDurationMinutes: 20 }),
      ],
      blocked: [],
      from: FROM,
      to: TO,
    });
    expect(slots).toHaveLength(2);
    expect(slots[0]!.startsAt.toISOString()).toBe("2026-07-06T20:00:00.000Z");
  });

  it("dedupes slots when identical schedule rows exist (no unique constraint on weekly_schedules)", () => {
    const slots = generateSlotsForRange({
      schedules: [mondaySchedule(), mondaySchedule(), mondaySchedule()],
      blocked: [],
      from: FROM,
      to: TO,
    });
    // Same 6 unique slots as a single schedule row — never duplicated.
    expect(slots).toHaveLength(6);
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("keeps distinct slots from overlapping but non-identical schedules", () => {
    const slots = generateSlotsForRange({
      schedules: [
        mondaySchedule(), // 09:00-12:00 / 30min
        mondaySchedule({ startTime: "11:00", endTime: "13:00" }), // overlaps 11:00-12:00
      ],
      blocked: [],
      from: FROM,
      to: TO,
    });
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(new Set(starts).size).toBe(starts.length); // 11:00/11:30 not doubled
    // 09:00..12:30 starts = 8 unique slots (12:00 and 12:30 from the second row)
    expect(slots).toHaveLength(8);
  });
});
