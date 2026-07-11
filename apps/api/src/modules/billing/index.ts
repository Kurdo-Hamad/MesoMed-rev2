/**
 * Billing module composition surface (MM-PLAN-001 §5 Phase 6b): the
 * booking-event subscribers that drive the unified charge ledger —
 * completed bookings accrue provider debt; cancelled/no-show bookings are
 * policy-evaluated with collection dormant behind the global
 * `billing.patient_collection_enabled` flag. Registered at the composition
 * root like every other module's subscribers (§3.1).
 */
import type { ConfigService } from "../../kernel/config.js";
import type { HandlerRegistry } from "../../kernel/events.js";
import type { OutboxEmitter } from "../../kernel/outbox.js";
import {
  createOnBookingCompleted,
  ON_BOOKING_COMPLETED_HANDLER,
} from "./events/on-booking-completed.js";
import {
  createOnBookingCancelled,
  createOnBookingNoShow,
  ON_BOOKING_CANCELLED_HANDLER,
  ON_BOOKING_NO_SHOW_HANDLER,
  type PolicyHandlerDeps,
} from "./events/on-booking-cancelled.js";
import type { PaymentGatewayRegistry } from "./shared.js";

export function registerBillingSubscribers(deps: {
  events: HandlerRegistry;
  outbox: OutboxEmitter;
  config: ConfigService;
  gateways: PaymentGatewayRegistry;
}): void {
  const policyDeps: PolicyHandlerDeps = {
    outbox: deps.outbox,
    config: deps.config,
    gateways: deps.gateways,
  };
  deps.events.on(
    "booking.completed.v1",
    ON_BOOKING_COMPLETED_HANDLER,
    createOnBookingCompleted({ outbox: deps.outbox }),
  );
  deps.events.on(
    "booking.cancelled.v1",
    ON_BOOKING_CANCELLED_HANDLER,
    createOnBookingCancelled(policyDeps),
  );
  deps.events.on(
    "booking.no_show.v1",
    ON_BOOKING_NO_SHOW_HANDLER,
    createOnBookingNoShow(policyDeps),
  );
}
