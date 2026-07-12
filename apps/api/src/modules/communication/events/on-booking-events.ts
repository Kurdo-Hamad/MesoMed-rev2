/**
 * Booking-event subscribers (MM-PLAN-001 §5 Phase 7): the event payload
 * carries appointment identifiers only — this handler re-reads the
 * doctor/location display names and plans the notification inside the
 * same transaction its idempotency claim was made on (§3.2), so planning
 * is exactly-once by construction.
 */
import type {
  bookingBookedV1,
  bookingCancelledV1,
  bookingRescheduledV1,
  EventEnvelope,
} from "@mesomed/contracts";
import type { DbTransaction } from "@mesomed/db";
import type { EventHandlerFn } from "../../../kernel/events.js";
import { getDoctorDisplayName } from "../../directory/queries/doctor-display-names.js";
import { getLocationNameForDoctorLocation } from "../../scheduling/queries/location-names.js";
import { planNotification } from "../commands/plan-notification.js";
import { formatAppointmentDateTime, pickLocalizedName } from "../templates.js";

export const ON_BOOKING_BOOKED_HANDLER = "communication.plan-booking-confirmation";
export const ON_BOOKING_RESCHEDULED_HANDLER = "communication.plan-reschedule-notice";
export const ON_BOOKING_CANCELLED_HANDLER = "communication.plan-cancellation-notice";

export const onBookingBooked: EventHandlerFn = async (envelope, tx, eventId) => {
  const { payload } = envelope as EventEnvelope<typeof bookingBookedV1>;
  await planBookingNotification(tx, payload, "booking_confirmation", eventId);
};

export const onBookingRescheduled: EventHandlerFn = async (envelope, tx, eventId) => {
  const { payload } = envelope as EventEnvelope<typeof bookingRescheduledV1>;
  await planBookingNotification(tx, payload, "reschedule_notice", eventId);
};

export const onBookingCancelled: EventHandlerFn = async (envelope, tx, eventId) => {
  const { payload } = envelope as EventEnvelope<typeof bookingCancelledV1>;
  await planBookingNotification(tx, payload, "cancellation_notice", eventId);
};

async function planBookingNotification(
  tx: DbTransaction,
  payload: {
    appointmentId: string;
    doctorLocationId: string;
    doctorProfileId: string;
    patientProfileId: string;
    startsAt: string;
  },
  template: "booking_confirmation" | "reschedule_notice" | "cancellation_notice",
  eventId: string,
): Promise<void> {
  const [doctorName, location] = await Promise.all([
    getDoctorDisplayName(tx, payload.doctorProfileId),
    getLocationNameForDoctorLocation(tx, payload.doctorLocationId),
  ]);
  if (!doctorName || !location) return; // Referenced profile/location no longer exists.

  const dateTime = formatAppointmentDateTime(payload.startsAt);
  await planNotification(tx, {
    patientProfileId: payload.patientProfileId,
    appointmentId: payload.appointmentId,
    template,
    // The triggering event's own id: stable across redeliveries of the
    // SAME booked/rescheduled/cancelled event, distinct for a SECOND
    // reschedule of the same appointment (a new event, ADR-0011 F-1).
    occurrenceKey: eventId,
    buildParams: (locale) => ({
      doctorName: pickLocalizedName(doctorName, locale),
      dateTime,
      locationName: pickLocalizedName(location, locale),
    }),
  });
}
