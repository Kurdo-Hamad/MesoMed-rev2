import type { EventName, EventRegistry } from "@mesomed/contracts/events";
import { domainEvents, type DbExecutor } from "@mesomed/db";

/**
 * Outbox writer (MM-PLAN-001 §3.2): `emit()` inserts the event into
 * `domain_events` on the caller's transaction handle, so the state
 * mutation and its integration event commit or roll back together.
 * Publication to subscribers is the dispatcher's job.
 */
export interface DomainEventInput {
  name: EventName;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
}

export interface OutboxEmitter {
  /** Validate against the registered contract and write the outbox row in-tx. */
  emit(tx: DbExecutor, event: DomainEventInput): Promise<string>;
}

export function createOutboxEmitter(registry: EventRegistry): OutboxEmitter {
  return {
    async emit(tx, event) {
      const contract = registry.get(event.name);
      if (!contract) {
        // Emitting an unregistered event is a programmer error, not a
        // request error — fail loudly before anything is written.
        throw new Error(`Cannot emit unregistered event "${event.name}"`);
      }
      const envelope = contract.envelope.parse({
        name: event.name,
        version: contract.version,
        payload: event.payload,
      });
      const [row] = await tx
        .insert(domainEvents)
        .values({
          name: envelope.name,
          version: envelope.version,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: envelope.payload,
        })
        .returning({ id: domainEvents.id });
      if (!row) throw new Error("Outbox insert returned no row");
      return row.id;
    },
  };
}
