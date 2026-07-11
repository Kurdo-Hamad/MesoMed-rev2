/**
 * Clinical subscriber for booking.completed.v1 (MM-PLAN-001 §5 Phase 5):
 * the ONLY way an encounter comes into existence. Runs on the handler's
 * idempotency-claimed transaction; the unique index on
 * `encounters.appointment_id` (1:1 with the appointment) plus the
 * channel's ON CONFLICT DO NOTHING make redelivery a provable no-op — the
 * encounter_created event is emitted only when this delivery actually
 * created the row.
 */
import type { EventEnvelope, bookingCompletedV1 } from "@mesomed/contracts";
import type { EventHandlerFn } from "../../../kernel/events.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { createEncounter, SYSTEM_ACTOR } from "../shared.js";

export const ON_BOOKING_COMPLETED_HANDLER = "clinical.create-encounter";

export function createOnBookingCompleted(deps: { outbox: OutboxEmitter }): EventHandlerFn {
  return async (envelope, tx) => {
    const { payload } = envelope as EventEnvelope<typeof bookingCompletedV1>;
    const startsAt = new Date(payload.startsAt);
    const endsAt = new Date(payload.endsAt);

    const { encounterId, created } = await createEncounter(tx, {
      appointmentId: payload.appointmentId,
      doctorProfileId: payload.doctorProfileId,
      patientProfileId: payload.patientProfileId,
      startsAt,
      endsAt,
      actor: SYSTEM_ACTOR,
    });
    if (!created) return;

    await deps.outbox.emit(tx, {
      name: "clinical.encounter_created.v1",
      aggregateType: "encounter",
      aggregateId: encounterId,
      payload: {
        encounterId,
        appointmentId: payload.appointmentId,
        doctorProfileId: payload.doctorProfileId,
        patientProfileId: payload.patientProfileId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    });
  };
}
