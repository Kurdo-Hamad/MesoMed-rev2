/**
 * Patient self-service read: the session's own appointments, resolved
 * through the identity module's published profile lookup (§3.1/§3.6
 * layer b — no profile means no rows, never someone else's).
 */
import type { z } from "zod";
import type { myAppointmentsOutputSchema } from "@mesomed/contracts/booking";
import { appointments, desc, eq, type DbExecutor } from "@mesomed/db";
import { getPatientProfileIdForUser } from "../../identity/queries/user-profiles.js";

export type MyAppointmentsOutput = z.output<typeof myAppointmentsOutputSchema>;

export async function listMyAppointments(
  db: DbExecutor,
  userId: string,
): Promise<MyAppointmentsOutput> {
  const patientProfileId = await getPatientProfileIdForUser(db, userId);
  if (patientProfileId === null) return { appointments: [] };

  const rows = await db
    .select({
      appointmentId: appointments.id,
      doctorLocationId: appointments.doctorLocationId,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      bookedVia: appointments.bookedVia,
    })
    .from(appointments)
    .where(eq(appointments.patientProfileId, patientProfileId))
    .orderBy(desc(appointments.startsAt))
    .limit(100);

  return {
    appointments: rows.map((row) => ({
      ...row,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    })),
  };
}
