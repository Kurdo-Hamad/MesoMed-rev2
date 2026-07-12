/**
 * Published appointment lookups for the Phase 6b billing module and the
 * clinical module (§3.1). Cancellation-policy evaluation needs the instant
 * the cancellation/no-show transition occurred; `cancelled` and `no_show`
 * are terminal states, so `status_changed_at` read at any later time IS
 * that instant — the evaluation stays deterministic under outbox
 * redelivery.
 */
import {
  and,
  appointments,
  eq,
  gte,
  inArray,
  lt,
  sql,
  type APPOINTMENT_STATUSES,
  type DbExecutor,
} from "@mesomed/db";

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface AppointmentTransitionRef {
  status: string;
  statusChangedAt: Date;
}

export async function getAppointmentTransitionRef(
  db: DbExecutor,
  appointmentId: string,
): Promise<AppointmentTransitionRef | null> {
  const [row] = await db
    .select({ status: appointments.status, statusChangedAt: appointments.statusChangedAt })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  return row ?? null;
}

/**
 * Published for the clinical module's continuity-of-care check (ADR-0010):
 * whether the patient has at least one appointment in any of the given
 * statuses at any of the given doctor locations. The caller supplies the
 * doctor-side location ids (scheduling's published query) and the status
 * set (`TREATING_APPOINTMENT_STATUSES` in `@mesomed/domain/clinical`) —
 * this function reads only booking's own table.
 */
export async function hasAppointmentForLocations(
  db: DbExecutor,
  doctorLocationIds: readonly string[],
  patientProfileId: string,
  statuses: readonly AppointmentStatus[],
): Promise<boolean> {
  if (doctorLocationIds.length === 0 || statuses.length === 0) return false;
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(appointments)
    .where(
      and(
        inArray(appointments.doctorLocationId, [...doctorLocationIds]),
        eq(appointments.patientProfileId, patientProfileId),
        inArray(appointments.status, [...statuses]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** An upcoming, still-active appointment eligible for a next-day reminder. */
export interface RemindableAppointment {
  appointmentId: string;
  doctorLocationId: string;
  patientProfileId: string;
  startsAt: Date;
}

/** Statuses a reminder should still fire for — a cancelled/completed booking gets none. */
const REMINDABLE_STATUSES: readonly AppointmentStatus[] = ["booked", "confirmed"];

/**
 * Published for the Phase 7 communication reminder cron (§3.1): scans the
 * indexed `(status, starts_at)` window rather than every appointment row
 * — an unbounded per-row scan is forbidden for this job (MM-ARC-002 §6.6).
 */
export async function listRemindableAppointments(
  db: DbExecutor,
  fromUtc: Date,
  toUtc: Date,
): Promise<RemindableAppointment[]> {
  return db
    .select({
      appointmentId: appointments.id,
      doctorLocationId: appointments.doctorLocationId,
      patientProfileId: appointments.patientProfileId,
      startsAt: appointments.startsAt,
    })
    .from(appointments)
    .where(
      and(
        inArray(appointments.status, [...REMINDABLE_STATUSES]),
        gte(appointments.startsAt, fromUtc),
        lt(appointments.startsAt, toUtc),
      ),
    );
}
