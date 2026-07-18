/**
 * Reschedule (MM-PLAN-001 §5 Phase 4): allowed from booked/confirmed/
 * delayed (ported RESCHEDULABLE_STATUSES); the new slot is validated and
 * conflict-checked in the same transaction as the move and the
 * booking.rescheduled.v1 event (§3.2/§3.4). The status is preserved — a
 * confirmed appointment stays confirmed at its new time — with one
 * exception (MM-DES-002 §4.4, D4): a delayed appointment resets to
 * confirmed, so booking.rescheduled.v1 never carries "delayed". Actor
 * rule (D4a): ANY_PARTY, EXCEPT from delayed where reschedule is
 * clinic-side only — the patient must not re-slot themselves after going
 * delayed; both the allow-list choice and the reset live here so the rule
 * is enforced server-side in one place.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  ANY_PARTY,
  assertTransition,
  CLINIC_SIDE,
  RESCHEDULABLE_STATUSES,
  rescheduleTargetStatus,
  type AppointmentStatus,
} from "@mesomed/domain/booking";
import { appointments, eq, type DbTransaction } from "@mesomed/db/modules/booking";
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
} from "../shared.js";

export interface RescheduleInput {
  appointmentId: string;
  newStartsAt: string;
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

  // D4a (MM-DES-002 §4.4, ruled 2026-07-14): reschedule from delayed is
  // CLINIC_SIDE only — narrows ANY_PARTY for the delayed-state case.
  const allowedActors = appointment.status === "delayed" ? CLINIC_SIDE : ANY_PARTY;
  await assertAppointmentActor(tx, session, appointment, doctorLocation, allowedActors);

  if (!(RESCHEDULABLE_STATUSES as readonly string[]).includes(appointment.status)) {
    throw new AppError(
      ErrorCode.INVALID_STATUS_TRANSITION,
      `Appointments in status "${appointment.status}" cannot be rescheduled`,
    );
  }

  // Status-preservation with the delayed -> confirmed reset (D4), asserted
  // through the map edge so the machine stays total.
  const targetStatus = rescheduleTargetStatus(appointment.status);
  if (targetStatus !== appointment.status) assertTransition(appointment.status, targetStatus);

  const slot = await resolveBookableSlot(tx, doctorLocation, new Date(input.newStartsAt), {
    ignoreAppointmentId: appointment.id,
  });

  const now = new Date();
  try {
    await tx
      .update(appointments)
      .set({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: targetStatus,
        statusChangedAt: now,
        updatedAt: now,
      })
      .where(eq(appointments.id, appointment.id));
  } catch (error) {
    if (isSlotUniqueViolation(error)) {
      throw new AppError(ErrorCode.SLOT_UNAVAILABLE, "This slot is already booked", {
        cause: error,
      });
    }
    throw error;
  }

  const moved = {
    ...appointment,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    status: targetStatus,
  };
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
    status: targetStatus,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
  };
}
