/**
 * Communication module assembly (MM-PLAN-001 §2, §5 Phase 7): registers
 * the event subscribers that plan notification deliveries. The sender's
 * background poll loop and the reminder cron job are started by the
 * composition root (Task 8 — real-vs-mock channel selection and the
 * mock-production guardrail live there), not here; this module only wires
 * the parts that have no runtime cost until an event actually fires.
 */
import type { HandlerRegistry } from "../../kernel/events.js";
import {
  ON_BOOKING_BOOKED_HANDLER,
  ON_BOOKING_CANCELLED_HANDLER,
  ON_BOOKING_RESCHEDULED_HANDLER,
  onBookingBooked,
  onBookingCancelled,
  onBookingRescheduled,
} from "./events/on-booking-events.js";
import {
  ON_SUBSCRIPTION_ACTIVATED_HANDLER,
  ON_SUBSCRIPTION_EXPIRED_HANDLER,
  onSubscriptionActivated,
  onSubscriptionExpired,
} from "./events/on-billing-events.js";
import {
  ON_PRESCRIPTION_ISSUED_HANDLER,
  onPrescriptionIssued,
} from "./events/on-prescription-issued.js";

export function registerCommunicationSubscribers(deps: { events: HandlerRegistry }): void {
  deps.events.on("booking.booked.v1", ON_BOOKING_BOOKED_HANDLER, onBookingBooked);
  deps.events.on("booking.rescheduled.v1", ON_BOOKING_RESCHEDULED_HANDLER, onBookingRescheduled);
  deps.events.on("booking.cancelled.v1", ON_BOOKING_CANCELLED_HANDLER, onBookingCancelled);
  deps.events.on(
    "billing.subscription_activated.v1",
    ON_SUBSCRIPTION_ACTIVATED_HANDLER,
    onSubscriptionActivated,
  );
  deps.events.on(
    "billing.subscription_expired.v1",
    ON_SUBSCRIPTION_EXPIRED_HANDLER,
    onSubscriptionExpired,
  );
  deps.events.on(
    "clinical.prescription_issued.v1",
    ON_PRESCRIPTION_ISSUED_HANDLER,
    onPrescriptionIssued,
  );
}
