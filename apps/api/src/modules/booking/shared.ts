/**
 * Booking module internals: slot resolution against the scheduling
 * module's published reads, appointment loading, layer-b actor checks
 * (§3.6), and the outbox snapshot every booking event carries.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import type { AppointmentStatus, BookingChannel } from "@mesomed/contracts/booking";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  findSlotByStart,
  intervalsOverlap,
  type AppointmentActorKind,
  type Interval,
} from "@mesomed/domain/booking";
import { generateSlotsForRange, getDayRangeInZone } from "@mesomed/domain/scheduling";
import {
  and,
  appointments,
  eq,
  gt,
  inArray,
  lt,
  type DbExecutor,
  type DbTransaction,
} from "@mesomed/db";
import { AppError } from "../../kernel/errors.js";
import type { Session } from "../../kernel/context.js";
import type { DomainEventInput } from "../../kernel/outbox.js";
import { getDoctorProfileIdForUser } from "../directory/queries/doctor-profile-refs.js";
import { getPatientProfileIdForUser } from "../identity/queries/user-profiles.js";
import {
  getDoctorLocation,
  getScheduleInputs,
  isSecretaryAssigned,
  type DoctorLocationRef,
} from "../scheduling/queries/schedule-inputs.js";

export interface AppointmentRow {
  id: string;
  doctorLocationId: string;
  patientProfileId: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  bookedVia: BookingChannel;
}

/** Load one appointment inside the caller's transaction, locked for update. */
export async function loadAppointmentForUpdate(
  tx: DbTransaction,
  appointmentId: string,
): Promise<AppointmentRow> {
  const [row] = await tx
    .select({
      id: appointments.id,
      doctorLocationId: appointments.doctorLocationId,
      patientProfileId: appointments.patientProfileId,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      bookedVia: appointments.bookedVia,
    })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .for("update");
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Appointment not found");
  return row;
}

/** Load the bookable doctor-location or fail with a typed error. */
export async function requireBookableDoctorLocation(
  db: DbExecutor,
  doctorLocationId: string,
): Promise<DoctorLocationRef> {
  const doctorLocation = await getDoctorLocation(db, doctorLocationId);
  if (!doctorLocation) throw new AppError(ErrorCode.NOT_FOUND, "Doctor location not found");
  if (!doctorLocation.bookable) {
    throw new AppError(ErrorCode.VALIDATION, "This doctor location is not accepting bookings");
  }
  return doctorLocation;
}

/**
 * Resolves the requested start instant to a concrete open slot of the
 * doctor-location's schedule and proves it free of active appointments —
 * all inside the caller's transaction (§3.4 strong consistency; the
 * partial unique index is the concurrency backstop).
 */
export async function resolveBookableSlot(
  tx: DbTransaction,
  doctorLocation: DoctorLocationRef,
  startsAt: Date,
  options: { now?: Date; ignoreAppointmentId?: string } = {},
): Promise<Interval> {
  const now = options.now ?? new Date();
  if (startsAt.getTime() <= now.getTime()) {
    throw new AppError(ErrorCode.VALIDATION, "Cannot book a slot in the past");
  }

  const day = getDayRangeInZone(startsAt, doctorLocation.timeZone);
  const inputs = await getScheduleInputs(tx, doctorLocation.doctorLocationId, day);
  const slots = generateSlotsForRange({
    schedules: inputs.schedules,
    blocked: inputs.blocked,
    from: day.from,
    to: day.to,
    timeZone: doctorLocation.timeZone,
  });

  const slot = findSlotByStart(slots, startsAt);
  if (!slot) {
    // Distinguish "blocked" from "never a slot" so clients can message it.
    const unblocked = generateSlotsForRange({
      schedules: inputs.schedules,
      blocked: [],
      from: day.from,
      to: day.to,
      timeZone: doctorLocation.timeZone,
    });
    if (findSlotByStart(unblocked, startsAt)) {
      throw new AppError(ErrorCode.SLOT_UNAVAILABLE, "This slot is blocked");
    }
    throw new AppError(ErrorCode.VALIDATION, "Not a bookable slot for this doctor location");
  }

  const busy = await tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.doctorLocationId, doctorLocation.doctorLocationId),
        inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        lt(appointments.startsAt, slot.endsAt),
        gt(appointments.endsAt, slot.startsAt),
      ),
    );
  const conflict = busy.some(
    (row) => row.id !== options.ignoreAppointmentId && intervalsOverlap(row, slot),
  );
  if (conflict) throw new AppError(ErrorCode.SLOT_UNAVAILABLE, "This slot is already booked");

  return slot;
}

/** True when `error` (or its cause chain) is the double-booking index firing. */
export function isSlotUniqueViolation(error: unknown): boolean {
  for (let cursor = error; cursor instanceof Error; cursor = cursor.cause as Error | undefined) {
    const candidate = cursor as Error & { code?: string; constraint?: string };
    if (
      candidate.code === "23505" &&
      (candidate.constraint === undefined ||
        candidate.constraint === "appointments_active_slot_unique")
    ) {
      return true;
    }
  }
  return false;
}

// ── Layer-b actor checks (§3.6) ────────────────────────────────────────

// Single source in the domain package (allowed-actions.ts) so affordance
// computation and enforcement share one definition.
export type AppointmentActor = AppointmentActorKind;

/**
 * Passes when the session satisfies at least one allowed actor binding
 * for this appointment's doctor-location/patient; throws FORBIDDEN
 * otherwise. Role membership alone is never enough (layer a already ran).
 */
export async function assertAppointmentActor(
  db: DbExecutor,
  session: Session,
  appointment: AppointmentRow,
  doctorLocation: DoctorLocationRef,
  allowed: readonly AppointmentActor[],
): Promise<void> {
  if (allowed.includes("admin") && session.roles.includes("admin")) return;

  if (allowed.includes("owning_doctor") && session.roles.includes("doctor")) {
    const doctorProfileId = await getDoctorProfileIdForUser(db, session.userId);
    if (doctorProfileId !== null && doctorProfileId === doctorLocation.doctorProfileId) return;
  }

  if (allowed.includes("assigned_secretary") && session.roles.includes("secretary")) {
    if (await isSecretaryAssigned(db, session.userId, appointment.doctorLocationId)) return;
  }

  if (allowed.includes("patient_owner") && session.roles.includes("patient")) {
    const patientProfileId = await getPatientProfileIdForUser(db, session.userId);
    if (patientProfileId !== null && patientProfileId === appointment.patientProfileId) return;
  }

  throw new AppError(ErrorCode.FORBIDDEN, "Not authorized for this appointment");
}

/** The denormalized snapshot every booking event carries (contracts). */
export function appointmentSnapshot(
  appointment: AppointmentRow,
  doctorLocation: DoctorLocationRef,
): {
  appointmentId: string;
  doctorLocationId: string;
  doctorProfileId: string;
  patientProfileId: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  bookedVia: BookingChannel;
} {
  return {
    appointmentId: appointment.id,
    doctorLocationId: appointment.doctorLocationId,
    doctorProfileId: doctorLocation.doctorProfileId,
    patientProfileId: appointment.patientProfileId,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    status: appointment.status,
    bookedVia: appointment.bookedVia,
  };
}

/** Outbox envelope helper — every booking event aggregates on the appointment. */
export function bookingEvent(
  name: DomainEventInput["name"],
  payload: unknown,
  appointmentId: string,
): DomainEventInput {
  return { name, aggregateType: "appointment", aggregateId: appointmentId, payload };
}
