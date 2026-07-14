/**
 * Appointments module — pure status-transition and slot-conflict logic
 * Module Owner: Appointments Team
 *
 * Pure functions only (no DB, no session) so they are unit-testable.
 */

export type AppointmentStatus =
  | "booked"
  | "confirmed"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show"
  | "delayed";

/**
 * Legal transitions per the MVP plan + Phase 9c delay (MM-DES-002 §1):
 *   booked -> confirmed -> checked_in -> in_progress -> completed
 *   booked/confirmed/delayed -> cancelled
 *   confirmed/checked_in/delayed -> no_show
 *   confirmed/checked_in -> delayed (delay); delayed -> checked_in (recall)
 *   delayed -> confirmed is reschedule's status reset ONLY — no action
 *   targets it (MM-DES-002 §4.4). checked_in <-> delayed is the map's
 *   first deliberate cycle (re-delay after recall).
 */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  booked: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show", "delayed"],
  checked_in: ["in_progress", "no_show", "delayed"],
  delayed: ["checked_in", "no_show", "cancelled", "confirmed"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

/**
 * Statuses that occupy a slot (conflict-relevant). A delayed appointment
 * is a live commitment — excluding it would silently lapse double-booking
 * protection if a future flow ever gave one a future instant (MM-DES-002 §1).
 */
export const ACTIVE_APPOINTMENT_STATUSES = [
  "booked",
  "confirmed",
  "checked_in",
  "in_progress",
  "delayed",
] as const satisfies readonly AppointmentStatus[];

/** Statuses from which an appointment may be rescheduled. */
export const RESCHEDULABLE_STATUSES = [
  "booked",
  "confirmed",
  "delayed",
] as const satisfies readonly AppointmentStatus[];

/**
 * Status an appointment lands in after a reschedule: the ADR-0006 §7
 * status-preservation rule with its one exception (MM-DES-002 §4.4, D4) —
 * a delayed appointment re-slotted to a future time is a normal confirmed
 * appointment again, so booking.rescheduled.v1 never carries "delayed".
 */
export function rescheduleTargetStatus(status: AppointmentStatus): AppointmentStatus {
  return status === "delayed" ? "confirmed" : status;
}

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
