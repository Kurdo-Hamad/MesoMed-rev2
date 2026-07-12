/**
 * Clinic-side day view (Phase 8 dashboards): every appointment at one
 * doctor-location on one calendar day in the location timezone. Layer-b
 * (§3.6) binds the session to the location — owning doctor, assigned
 * secretary, or admin; role membership alone is never enough. Patient
 * names/phones come from identity's published bulk contact lookup (§3.1),
 * never a raw join into identity tables.
 */
import type { z } from "zod";
import type { clinicDayOutputSchema } from "@mesomed/contracts/booking";
import { ErrorCode } from "@mesomed/contracts/errors";
import { getDayRangeInZone } from "@mesomed/domain/scheduling";
import { and, appointments, asc, eq, gte, lt, type DbExecutor } from "@mesomed/db";
import type { Session } from "../../../kernel/context.js";
import { AppError } from "../../../kernel/errors.js";
import { getDoctorProfileIdForUser } from "../../directory/queries/doctor-profile-refs.js";
import { getPatientContacts } from "../../identity/queries/patient-contacts.js";
import {
  getDoctorLocation,
  isSecretaryAssigned,
} from "../../scheduling/queries/schedule-inputs.js";

export type ClinicDayOutput = z.output<typeof clinicDayOutputSchema>;

export async function getClinicDay(
  db: DbExecutor,
  session: Session,
  input: { doctorLocationId: string; anchor?: string | undefined; now?: Date },
): Promise<ClinicDayOutput> {
  const doctorLocation = await getDoctorLocation(db, input.doctorLocationId);
  if (!doctorLocation) throw new AppError(ErrorCode.NOT_FOUND, "Doctor location not found");

  // Layer b: admin, owning doctor, or assigned secretary — same bindings
  // as the lifecycle commands' actor matrix.
  let bound = session.roles.includes("admin");
  if (!bound && session.roles.includes("doctor")) {
    const doctorProfileId = await getDoctorProfileIdForUser(db, session.userId);
    bound = doctorProfileId !== null && doctorProfileId === doctorLocation.doctorProfileId;
  }
  if (!bound && session.roles.includes("secretary")) {
    bound = await isSecretaryAssigned(db, session.userId, input.doctorLocationId);
  }
  if (!bound) {
    throw new AppError(ErrorCode.FORBIDDEN, "Not authorized for this doctor location");
  }

  const anchor = input.anchor ? new Date(input.anchor) : (input.now ?? new Date());
  const day = getDayRangeInZone(anchor, doctorLocation.timeZone);

  const rows = await db
    .select({
      appointmentId: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      bookedVia: appointments.bookedVia,
      patientProfileId: appointments.patientProfileId,
      note: appointments.note,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.doctorLocationId, input.doctorLocationId),
        gte(appointments.startsAt, day.from),
        lt(appointments.startsAt, day.to),
      ),
    )
    .orderBy(asc(appointments.startsAt));

  const contacts = await getPatientContacts(db, [
    ...new Set(rows.map((row) => row.patientProfileId)),
  ]);

  // YYYY-MM-DD label of the returned day in the location timezone.
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: doctorLocation.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(day.from);

  return {
    doctorLocationId: input.doctorLocationId,
    timeZone: doctorLocation.timeZone,
    date,
    appointments: rows.map((row) => {
      const contact = contacts.get(row.patientProfileId);
      return {
        appointmentId: row.appointmentId,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        status: row.status,
        bookedVia: row.bookedVia,
        patientProfileId: row.patientProfileId,
        patientName: contact?.fullName ?? null,
        patientPhone: contact?.normalizedPhone ?? null,
        note: row.note,
      };
    }),
  };
}
