/**
 * Reschedule (MM-PLAN-001 §5 Phase 4): allowed from booked/confirmed only
 * (ported RESCHEDULABLE_STATUSES); the new slot is validated and
 * conflict-checked in the same transaction as the move and the
 * booking.rescheduled.v1 event (§3.2/§3.4). The status is preserved — a
 * confirmed appointment stays confirmed at its new time.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import { RESCHEDULABLE_STATUSES, type AppointmentStatus } from "@mesomed/domain/booking";
import { appointments, eq, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { Session } from "../../../kernel/context.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { getDoctorLocation } from "../../scheduling/queries/schedule-inputs.js";
import {
  appointmentSnapshot,
  assertAppointmentActor,
  bookingEvent,
  isSlotUniqueViolation,
  loadAppointmentForUpdate,
  resolveBookableSlot,
  type AppointmentActor,
} from "../shared.js";

export interface RescheduleInput {
  appointmentId: string;
  newStartsAt: string;
  allowedActors: readonly AppointmentActor[];
}

export interface RescheduleResult {
  appointmentId: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
}

export async function rescheduleAppointment(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: RescheduleInput,
): Promise<RescheduleResult> {
  const appointment = await loadAppointmentForUpdate(tx, input.appointmentId);
  const doctorLocation = await getDoctorLocation(tx, appointment.doctorLocationId);
  if (!doctorLocation) throw new AppError(ErrorCode.INTERNAL, "Doctor location row missing");

  await assertAppointmentActor(tx, session, appointment, doctorLocation, input.allowedActors);

  if (!(RESCHEDULABLE_STATUSES as readonly string[]).includes(appointment.status)) {
    throw new AppError(
      ErrorCode.INVALID_STATUS_TRANSITION,
      `Appointments in status "${appointment.status}" cannot be rescheduled`,
    );
  }

  const slot = await resolveBookableSlot(tx, doctorLocation, new Date(input.newStartsAt), {
    ignoreAppointmentId: appointment.id,
  });

  const now = new Date();
  try {
    await tx
      .update(appointments)
      .set({ startsAt: slot.startsAt, endsAt: slot.endsAt, statusChangedAt: now, updatedAt: now })
      .where(eq(appointments.id, appointment.id));
  } catch (error) {
    if (isSlotUniqueViolation(error)) {
      throw new AppError(ErrorCode.SLOT_UNAVAILABLE, "This slot is already booked", {
        cause: error,
      });
    }
    throw error;
  }

  const moved = { ...appointment, startsAt: slot.startsAt, endsAt: slot.endsAt };
  await outbox.emit(
    tx,
    bookingEvent(
      "booking.rescheduled.v1",
      {
        ...appointmentSnapshot(moved, doctorLocation),
        previousStartsAt: appointment.startsAt.toISOString(),
        previousEndsAt: appointment.endsAt.toISOString(),
      },
      appointment.id,
    ),
  );

  return {
    appointmentId: appointment.id,
    status: appointment.status,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
  };
}
