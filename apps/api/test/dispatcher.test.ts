import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { createEventRegistry, defineEvent, type AnyEventEnvelope } from "@mesomed/contracts/events";
import { configEntries, domainEvents, eq, processedEvents } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../src/app.js";
import { createHandlerRegistry } from "../src/kernel/events.js";
import { testEnv, waitFor } from "./helpers.js";

const thingHappened = defineEvent("test", "thing_happened", 1, z.object({ thingId: z.string() }));
const poisonSwallowed = defineEvent("test", "poison_swallowed", 1, z.object({}));

/**
 * Phase 1 gate, parts 2 and 3 (MM-PLAN-001 §5): the dispatcher delivers an
 * event to a subscriber exactly once under forced retry, and a poisoned
 * event lands in the dead-letter queue with its attempts recorded. Runs
 * against the real composition root with test-fast retry timings
 * (OUTBOX_RETRY_LIMIT=1, OUTBOX_RETRY_DELAY_S=0 — see helpers.ts).
 */
describe("outbox dispatcher", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  const flakyDeliveries: AnyEventEnvelope[] = [];
  let flakyFailuresRemaining = 1;
  let poisonAttempts = 0;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const handlers = createHandlerRegistry();

    // Fails exactly once, then succeeds: the forced-retry subscriber. Its
    // durable effect is a config row written through the handler tx.
    handlers.on("test.thing_happened.v1", "flaky-projector", async (envelope, tx) => {
      flakyDeliveries.push(envelope);
      if (flakyFailuresRemaining > 0) {
        flakyFailuresRemaining -= 1;
        throw new Error("transient projector failure");
      }
      const payload = envelope.payload as { thingId: string };
      await tx
        .insert(configEntries)
        .values({ key: `projection:${payload.thingId}`, value: { projected: true } });
    });

    // Never succeeds: the poison pill.
    handlers.on("test.poison_swallowed.v1", "poison-handler", () => {
      poisonAttempts += 1;
      throw new Error("poison: this handler always fails");
    });

    app = await buildServer(testEnv(tdb.connectionString), {
      eventRegistry: createEventRegistry([thingHappened, poisonSwallowed]),
      eventHandlers: handlers,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("delivers to a subscriber exactly once under forced retry", async () => {
    const { db, outbox } = app.kernel;
    const eventId = await db.transaction(async (tx) =>
      outbox.emit(tx, {
        name: "test.thing_happened.v1",
        aggregateType: "thing",
        aggregateId: "t-1",
        payload: { thingId: "t-1" },
      }),
    );

    const processed = await waitFor(async () => {
      const [row] = await db.select().from(domainEvents).where(eq(domainEvents.id, eventId));
      return row?.status === "processed" ? row : undefined;
    });

    // The handler ran twice (fail, then success) …
    expect(flakyDeliveries).toHaveLength(2);
    expect(processed.attempts).toBe(2);
    // … but its durable effect happened exactly once, because the failed
    // attempt's transaction (claim + write) rolled back atomically.
    const projections = await db
      .select()
      .from(configEntries)
      .where(eq(configEntries.key, "projection:t-1"));
    expect(projections).toHaveLength(1);
    const claims = await db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.eventId, eventId));
    expect(claims).toEqual([expect.objectContaining({ eventId, handler: "flaky-projector" })]);
    expect(processed.publishedAt).not.toBeNull();
    expect(processed.lastError).toBeNull();
  });

  it("re-delivering an already-processed event id is a no-op (idempotent handler registry)", async () => {
    const { db, dispatcher } = app.kernel;
    const [event] = await db.select().from(domainEvents).where(eq(domainEvents.aggregateId, "t-1"));
    expect(event).toBeDefined();
    const deliveriesBefore = flakyDeliveries.length;

    // Force the exact duplicate-delivery path the queue would take.
    await app.kernel.dispatcher.redeliver(event!.id);
    await dispatcher.redeliver(event!.id);

    expect(flakyDeliveries).toHaveLength(deliveriesBefore);
    const projections = await db
      .select()
      .from(configEntries)
      .where(eq(configEntries.key, "projection:t-1"));
    expect(projections).toHaveLength(1);
  });

  it("lands a poisoned event in dead-letter with attempts recorded", async () => {
    const { db, outbox } = app.kernel;
    const eventId = await db.transaction(async (tx) =>
      outbox.emit(tx, {
        name: "test.poison_swallowed.v1",
        aggregateType: "poison",
        aggregateId: "p-1",
        payload: {},
      }),
    );

    const dead = await waitFor(async () => {
      const [row] = await db.select().from(domainEvents).where(eq(domainEvents.id, eventId));
      return row?.status === "dead" ? row : undefined;
    });

    // retryLimit=1 → initial attempt + one retry, both recorded.
    expect(dead.attempts).toBe(2);
    expect(poisonAttempts).toBe(2);
    expect(dead.lastError).toMatch(/poison: this handler always fails/);
    // No durable claim exists: every attempt rolled back.
    const claims = await db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.eventId, eventId));
    expect(claims).toHaveLength(0);
  });
});
