import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { createEventRegistry, defineEvent } from "@mesomed/contracts/events";
import { configEntries, domainEvents } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../src/app.js";
import { testEnv } from "./helpers.js";

const thingHappened = defineEvent("test", "thing_happened", 1, z.object({ thingId: z.string() }));

/**
 * Phase 1 gate, part 1 (MM-PLAN-001 §5): a command transaction writes its
 * state row and its outbox event atomically — commit keeps both, rollback
 * keeps neither. The "state row" here is a config entry: the kernel's own
 * table, so the proof needs no business schema.
 */
describe("transactional outbox emit", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString), {
      eventRegistry: createEventRegistry([thingHappened]),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("commit writes the state row and the outbox row together", async () => {
    const { db, outbox } = app.kernel;
    let eventId = "";
    await db.transaction(async (tx) => {
      await tx.insert(configEntries).values({ key: "outbox-commit-probe", value: { n: 1 } });
      eventId = await outbox.emit(tx, {
        name: "test.thing_happened.v1",
        aggregateType: "thing",
        aggregateId: "t-commit",
        payload: { thingId: "t-commit" },
      });
    });

    const events = await db.select().from(domainEvents);
    const committed = events.find((event) => event.id === eventId);
    expect(committed).toBeDefined();
    expect(committed).toMatchObject({
      name: "test.thing_happened.v1",
      version: 1,
      aggregateType: "thing",
      aggregateId: "t-commit",
      payload: { thingId: "t-commit" },
    });
  });

  it("rollback leaves neither the state row nor the outbox row", async () => {
    const { db, outbox } = app.kernel;
    const sentinel = new Error("force rollback");
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(configEntries).values({ key: "outbox-rollback-probe", value: {} });
        await outbox.emit(tx, {
          name: "test.thing_happened.v1",
          aggregateType: "thing",
          aggregateId: "t-rollback",
          payload: { thingId: "t-rollback" },
        });
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);

    const [entries, events] = await Promise.all([
      db.select().from(configEntries),
      db.select().from(domainEvents),
    ]);
    expect(entries.find((entry) => entry.key === "outbox-rollback-probe")).toBeUndefined();
    expect(events.find((event) => event.aggregateId === "t-rollback")).toBeUndefined();
  });

  it("rejects an emit whose payload violates the event contract, writing nothing", async () => {
    const { db, outbox } = app.kernel;
    await expect(
      db.transaction(async (tx) =>
        outbox.emit(tx, {
          name: "test.thing_happened.v1",
          aggregateType: "thing",
          aggregateId: "t-invalid",
          payload: { wrong: true },
        }),
      ),
    ).rejects.toThrow();
    const events = await db.select().from(domainEvents);
    expect(events.find((event) => event.aggregateId === "t-invalid")).toBeUndefined();
  });

  it("rejects an emit for an event no contract was registered for", async () => {
    const { db, outbox } = app.kernel;
    await expect(
      db.transaction(async (tx) =>
        outbox.emit(tx, {
          name: "test.unregistered.v1",
          aggregateType: "thing",
          aggregateId: "t-unregistered",
          payload: {},
        }),
      ),
    ).rejects.toThrow(/unregistered/);
  });
});
