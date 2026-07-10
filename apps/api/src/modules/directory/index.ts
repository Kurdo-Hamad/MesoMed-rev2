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

export function registerDirectorySubscribers(deps: {
  events: HandlerRegistry;
  outbox: OutboxEmitter;
}): void {
  deps.events.on(
    "identity.provider_status_changed.v1",
    ON_PROVIDER_STATUS_CHANGED_HANDLER,
    createOnProviderStatusChanged({ outbox: deps.outbox }),
  );
}
