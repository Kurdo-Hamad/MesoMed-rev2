/**
 * Clinical module composition surface (MM-PLAN-001 §5 Phase 5): the
 * subscriber that creates encounters from booking.completed.v1 — the only
 * encounter-creation path in the system — registered at the composition
 * root like every other module's subscribers (§3.1).
 */
import type { HandlerRegistry } from "../../kernel/events.js";
import type { OutboxEmitter } from "../../kernel/outbox.js";
import {
  createOnBookingCompleted,
  ON_BOOKING_COMPLETED_HANDLER,
} from "./events/on-booking-completed.js";

export function registerClinicalSubscribers(deps: {
  events: HandlerRegistry;
  outbox: OutboxEmitter;
}): void {
  deps.events.on(
    "booking.completed.v1",
    ON_BOOKING_COMPLETED_HANDLER,
    createOnBookingCompleted({ outbox: deps.outbox }),
  );
}
