import type { AnyEventEnvelope, EventName } from "@mesomed/contracts/events";
import type { DbTransaction } from "@mesomed/db";

/**
 * Subscriber registry for domain events. Handlers are keyed by
 * (event name, handler name): the handler name is the idempotency identity
 * recorded in `processed_events`, so it must be stable across deploys —
 * treat it like a migration name, not a label.
 *
 * A handler receives the validated envelope plus the transaction its
 * idempotency claim was made on; effects written through that transaction
 * are exactly-once by construction (see dispatcher).
 */
export type EventHandlerFn = (
  envelope: AnyEventEnvelope,
  tx: DbTransaction,
) => void | Promise<void>;

export interface EventHandler {
  name: string;
  fn: EventHandlerFn;
}

export interface HandlerRegistry {
  on(event: EventName, handlerName: string, fn: EventHandlerFn): void;
  handlersFor(event: string): readonly EventHandler[];
}

export function createHandlerRegistry(): HandlerRegistry {
  const byEvent = new Map<EventName, EventHandler[]>();
  return {
    on(event, handlerName, fn) {
      const handlers = byEvent.get(event) ?? [];
      if (handlers.some((handler) => handler.name === handlerName)) {
        throw new Error(`Duplicate handler "${handlerName}" for event "${event}"`);
      }
      handlers.push({ name: handlerName, fn });
      byEvent.set(event, handlers);
    },
    handlersFor(event) {
      return byEvent.get(event as EventName) ?? [];
    },
  };
}
