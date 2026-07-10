/**
 * Appointments module — pure status-transition and slot-conflict logic
 * Module Owner: Appointments Team
 *
 * Pure functions only (no DB, no session) so they are unit-testable.
 */

export type AppointmentStatus =
  "booked" | "confirmed" | "checked_in" | "in_progress" | "completed" | "cancelled" | "no_show";

/**
 * Legal transitions per the MVP plan:
 *   booked -> confirmed -> checked_in -> in_progress -> completed
 *   booked/confirmed -> cancelled
 *   confirmed/checked_in -> no_show
 */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  booked: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_progress", "no_show"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** Statuses that occupy a slot (conflict-relevant). */
export const ACTIVE_APPOINTMENT_STATUSES = [
  "booked",
  "confirmed",
  "checked_in",
  "in_progress",
] as const satisfies readonly AppointmentStatus[];

/** Statuses from which an appointment may be rescheduled. */
export const RESCHEDULABLE_STATUSES = [
  "booked",
  "confirmed",
] as const satisfies readonly AppointmentStatus[];

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: AppointmentStatus,
    public readonly to: AppointmentStatus,
  ) {
    super(`Illegal appointment status transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}

// ---------------------------------------------------------------------------
// Slot-conflict logic
// ---------------------------------------------------------------------------

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

/** Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd). */
export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
}

/** Slots that do not overlap any busy interval. */
export function subtractBusyIntervals<T extends Interval>(slots: T[], busy: Interval[]): T[] {
  if (busy.length === 0) {
    return slots;
  }
  return slots.filter((slot) => !busy.some((b) => intervalsOverlap(slot, b)));
}

/** The slot starting exactly at `startsAt`, or null. */
export function findSlotByStart<T extends Interval>(slots: T[], startsAt: Date): T | null {
  return slots.find((s) => s.startsAt.getTime() === startsAt.getTime()) ?? null;
}
