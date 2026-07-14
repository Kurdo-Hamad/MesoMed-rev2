/**
 * Lifecycle transitions (confirm / check-in / start / complete / no-show /
 * cancel / delay / recall) over the ported state machine
 * (packages/domain/booking). Each command is a role-gated procedure (§3.6
 * layer a in the router) named by its action; sources, target and actor
 * allow-list are all enforced here from the SAME edge-table record the
 * allowedActions affordances read (MM-DES-002 §2 — the router no longer
 * picks allow-lists per call), with the status write and its event in one
 * transaction (§3.2). Transitions with no integration consumer
 * (checked_in via checkIn or recall, in_progress) emit nothing — events
 * are contracts, not a changelog (§3.3).
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import type { AppointmentAction, AppointmentStatus } from "@mesomed/contracts/booking";
import {
  APPOINTMENT_ACTION_EDGES,
  assertTransition,
  IllegalTransitionError,
} from "@mesomed/domain/booking";
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
} from "../shared.js";

const TRANSITION_EVENTS: Partial<Record<AppointmentStatus, EventName>> = {
  confirmed: "booking.confirmed.v1",
  cancelled: "booking.cancelled.v1",
  completed: "booking.completed.v1",
  no_show: "booking.no_show.v1",
  delayed: "booking.delayed.v1",
};

export interface TransitionInput {
  appointmentId: string;
  action: AppointmentAction;
  reason?: string | undefined;
}

export async function transitionAppointment(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: TransitionInput,
): Promise<{ appointmentId: string; status: AppointmentStatus }> {
  const edge = APPOINTMENT_ACTION_EDGES[input.action];
  const appointment = await loadAppointmentForUpdate(tx, input.appointmentId);
  const doctorLocation = await getDoctorLocation(tx, appointment.doctorLocationId);
  if (!doctorLocation) throw new AppError(ErrorCode.INTERNAL, "Doctor location row missing");

  await assertAppointmentActor(tx, session, appointment, doctorLocation, edge.actors);

  // The edge's explicit sources gate the action — target-derivation alone
  // cannot tell recall from checkIn (both land in checked_in, MM-DES-002 §2).
  if (!edge.sources.includes(appointment.status)) {
    throw new AppError(
      ErrorCode.INVALID_STATUS_TRANSITION,
      `Action "${input.action}" is not available in status "${appointment.status}"`,
    );
  }

  // Consistency assertion against the transition map: the domain unit
  // proof pins every edge source/target pair legal, so this cannot fire.
  try {
    assertTransition(appointment.status, edge.target);
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
      status: edge.target,
      cancellationReason: edge.target === "cancelled" ? (input.reason ?? null) : undefined,
      statusChangedAt: now,
      updatedAt: now,
    })
    .where(eq(appointments.id, appointment.id));

  const eventName = TRANSITION_EVENTS[edge.target];
  if (eventName) {
    const snapshot = appointmentSnapshot({ ...appointment, status: edge.target }, doctorLocation);
    const payload =
      edge.target === "cancelled" ? { ...snapshot, reason: input.reason ?? null } : snapshot;
    await outbox.emit(tx, bookingEvent(eventName, payload, appointment.id));
  }

  return { appointmentId: appointment.id, status: edge.target };
}
