/**
 * Continuity-of-care access rule (clinical extension, ADR-0010): a doctor
 * may read a patient's clinical history only while holding a TREATING
 * RELATIONSHIP — at least one appointment with that patient in a status
 * that represents care given or committed. Cancelled and no-show
 * appointments never establish one.
 */

export const TREATING_APPOINTMENT_STATUSES = [
  "booked",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
] as const;

export type TreatingAppointmentStatus = (typeof TREATING_APPOINTMENT_STATUSES)[number];

/** Whether any of the given appointment statuses establishes a treating relationship. */
export function hasTreatingStatus(statuses: readonly string[]): boolean {
  return statuses.some((status) =>
    (TREATING_APPOINTMENT_STATUSES as readonly string[]).includes(status),
  );
}
