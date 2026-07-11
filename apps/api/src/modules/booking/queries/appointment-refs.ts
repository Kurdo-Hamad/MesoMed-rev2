/**
 * Published appointment lookups for the Phase 6b billing module (§3.1).
 * Cancellation-policy evaluation needs the instant the cancellation/no-show
 * transition occurred; `cancelled` and `no_show` are terminal states, so
 * `status_changed_at` read at any later time IS that instant — the
 * evaluation stays deterministic under outbox redelivery.
 */
import { appointments, eq, type DbExecutor } from "@mesomed/db";

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
