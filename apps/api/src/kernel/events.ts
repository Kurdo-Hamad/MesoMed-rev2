import type { AnyEventEnvelope, EventName } from "@mesomed/contracts/events";
import type { DbTransaction } from "@mesomed/db";

/**
 * Subscriber registry for domain events. Handlers are keyed by
 * (event name, handler name): the handler name is the idempotency identity
 * recorded in `processed_events`, so it must be stable across deploys —
 * treat it like a migration name, not a label.
 *
 * A handler receives the validated envelope, the transaction its
 * idempotency claim was made on (effects written through it are
 * exactly-once by construction — see dispatcher), and the triggering
 * `domain_events.id`. That id is stable across redeliveries of the SAME
 * occurrence and distinct for every NEW occurrence — the correct primitive
 * for a handler that needs to distinguish "this event redelivered" from
 * "a new event of the same kind for the same aggregate" (e.g. a second
 * reschedule of the same appointment). Most handlers don't need it and can
 * keep declaring a 2-parameter function — TS permits assigning a function
 * with fewer parameters where more are declared.
 */
export type EventHandlerFn = (
  envelope: AnyEventEnvelope,
  tx: DbTransaction,
  eventId: string,
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
