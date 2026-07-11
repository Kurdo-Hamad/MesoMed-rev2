/**
 * Directory module assembly (MM-PLAN-001 §2, §5 Phase 3). The composition
 * root registers the module's event subscribers here; the router is created
 * separately because the root tRPC router composes it.
 */
import type { HandlerRegistry } from "../../kernel/events.js";
import type { OutboxEmitter } from "../../kernel/outbox.js";
import {
  createOnProviderStatusChanged,
  ON_PROVIDER_STATUS_CHANGED_HANDLER,
} from "./events/on-provider-status-changed.js";
import {
  createOnSubscriptionActivated,
  createOnSubscriptionExpired,
  ON_SUBSCRIPTION_ACTIVATED_HANDLER,
  ON_SUBSCRIPTION_EXPIRED_HANDLER,
} from "./events/on-subscription-changed.js";
import {
  createOnTierPaymentRecorded,
  ON_TIER_PAYMENT_RECORDED_HANDLER,
} from "./events/on-tier-payment-recorded.js";

export function registerDirectorySubscribers(deps: {
  events: HandlerRegistry;
  outbox: OutboxEmitter;
}): void {
  deps.events.on(
    "identity.provider_status_changed.v1",
    ON_PROVIDER_STATUS_CHANGED_HANDLER,
    createOnProviderStatusChanged({ outbox: deps.outbox }),
  );
  // Phase 6: billing state reaches the directory ONLY through these events;
  // the directory mirrors it into its own columns and recomputes visibility.
  deps.events.on(
    "billing.subscription_activated.v1",
    ON_SUBSCRIPTION_ACTIVATED_HANDLER,
    createOnSubscriptionActivated({ outbox: deps.outbox }),
  );
  deps.events.on(
    "billing.subscription_expired.v1",
    ON_SUBSCRIPTION_EXPIRED_HANDLER,
    createOnSubscriptionExpired({ outbox: deps.outbox }),
  );
  deps.events.on(
    "billing.tier_payment_recorded.v1",
    ON_TIER_PAYMENT_RECORDED_HANDLER,
    createOnTierPaymentRecorded({ outbox: deps.outbox }),
  );
}
