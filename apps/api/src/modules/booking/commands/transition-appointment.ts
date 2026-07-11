/**
 * Lifecycle transitions (confirm / check-in / start / complete / no-show /
 * cancel) over the ported state machine (packages/domain/booking). Each
 * command is a role-gated procedure (§3.6 layer a in the router) whose
 * actor binding is proven here against the loaded row (layer b), with the
 * status write and its event in one transaction (§3.2). Transitions with
 * no integration consumer (checked_in, in_progress) emit nothing — events
 * are contracts, not a changelog (§3.3).
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import type { AppointmentStatus } from "@mesomed/contracts/booking";
import { assertTransition, IllegalTransitionError } from "@mesomed/domain/booking";
import type { EventName } from "@mesomed/contracts/events";
import { appointments, eq, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { Session } from "../../../kernel/context.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { getDoctorLocation } from "../../scheduling/queries/schedule-inputs.js";
import {
  appointmentSnapshot,
  assertAppointmentActor,
  bookingEvent,
  loadAppointmentForUpdate,
  type AppointmentActor,
} from "../shared.js";

const TRANSITION_EVENTS: Partial<Record<AppointmentStatus, EventName>> = {
  confirmed: "booking.confirmed.v1",
  cancelled: "booking.cancelled.v1",
  completed: "booking.completed.v1",
  no_show: "booking.no_show.v1",
};

export interface TransitionInput {
  appointmentId: string;
  to: AppointmentStatus;
  allowedActors: readonly AppointmentActor[];
  reason?: string | undefined;
}

export async function transitionAppointment(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: TransitionInput,
): Promise<{ appointmentId: string; status: AppointmentStatus }> {
  const appointment = await loadAppointmentForUpdate(tx, input.appointmentId);
  const doctorLocation = await getDoctorLocation(tx, appointment.doctorLocationId);
  if (!doctorLocation) throw new AppError(ErrorCode.INTERNAL, "Doctor location row missing");

  await assertAppointmentActor(tx, session, appointment, doctorLocation, input.allowedActors);

  try {
    assertTransition(appointment.status, input.to);
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION, error.message, { cause: error });
    }
    throw error;
  }

  const now = new Date();
  await tx
    .update(appointments)
    .set({
      status: input.to,
      cancellationReason: input.to === "cancelled" ? (input.reason ?? null) : undefined,
      statusChangedAt: now,
      updatedAt: now,
    })
    .where(eq(appointments.id, appointment.id));

  const eventName = TRANSITION_EVENTS[input.to];
  if (eventName) {
    const snapshot = appointmentSnapshot({ ...appointment, status: input.to }, doctorLocation);
    const payload =
      input.to === "cancelled" ? { ...snapshot, reason: input.reason ?? null } : snapshot;
    await outbox.emit(tx, bookingEvent(eventName, payload, appointment.id));
  }

  return { appointmentId: appointment.id, status: input.to };
}
