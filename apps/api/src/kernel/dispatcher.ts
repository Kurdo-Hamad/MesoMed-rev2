import { PgBoss } from "pg-boss";
import type { FastifyBaseLogger } from "fastify";
import type { EventRegistry } from "@mesomed/contracts/events";
import { type Db, domainEvents, eq, processedEvents, sql } from "@mesomed/db";
import type { HandlerRegistry } from "./events.js";

/**
 * Outbox dispatcher (MM-PLAN-001 §3.2, §5 Phase 1): polls `domain_events`
 * for pending rows, hands them to a pg-boss queue, and executes registered
 * handlers with retry + exponential backoff; exhausted retries land the
 * event in a dead-letter queue and mark the row `dead`.
 *
 * Delivery semantics: publication is at-least-once (a crash between
 * enqueue and the `published` flag re-sends the event), and each handler
 * runs inside a transaction that first claims a `processed_events` row
 * (INSERT … ON CONFLICT DO NOTHING). A duplicate delivery therefore finds
 * the claim taken and is a no-op — effectively-once per (event, handler).
 */
export const OUTBOX_QUEUE = "domain-events";
export const OUTBOX_DEAD_LETTER_QUEUE = "domain-events.dead";

interface OutboxJobData {
  eventId: string;
}

export interface OutboxDispatcherOptions {
  connectionString: string;
  db: Db;
  registry: EventRegistry;
  handlers: HandlerRegistry;
  log: FastifyBaseLogger;
  /** How often the pump scans for pending outbox rows (ms). */
  pollIntervalMs: number;
  /** pg-boss worker poll interval (seconds, min 0.5). */
  workerPollIntervalS: number;
  /** Retries after the first failed attempt before dead-lettering. */
  retryLimit: number;
  /** Base delay between retries (seconds); grows exponentially. */
  retryDelayS: number;
}

export interface OutboxDispatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
  isStarted(): boolean;
  /** Run one pump pass immediately (tests, ops tooling). */
  pump(): Promise<void>;
  /** Re-deliver one event through the normal handler path (idempotent). */
  redeliver(eventId: string): Promise<void>;
}

const PUMP_BATCH_SIZE = 50;
const MAX_ERROR_LENGTH = 2_000;

export function createOutboxDispatcher(options: OutboxDispatcherOptions): OutboxDispatcher {
  const { db, registry, handlers, log } = options;
  const boss = new PgBoss({
    connectionString: options.connectionString,
    migrate: true,
    supervise: true,
    schedule: false,
  });
  boss.on("error", (error) => log.error(error, "pg-boss error"));

  let started = false;
  let pumping = false;
  let pumpTimer: NodeJS.Timeout | undefined;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      const pending = await db
        .select({ id: domainEvents.id })
        .from(domainEvents)
        .where(eq(domainEvents.status, "pending"))
        .orderBy(domainEvents.occurredAt)
        .limit(PUMP_BATCH_SIZE);
      for (const { id } of pending) {
        // Enqueue first, then flip the row: a crash in between re-sends the
        // event (at-least-once), which the handler idempotency claim absorbs.
        // singletonKey additionally dedupes a re-send while the first job is
        // still queued.
        await boss.send(OUTBOX_QUEUE, { eventId: id } satisfies OutboxJobData, {
          singletonKey: id,
        });
        await db
          .update(domainEvents)
          .set({ status: "published", publishedAt: new Date() })
          .where(eq(domainEvents.id, id));
      }
    } finally {
      pumping = false;
    }
  }

  async function processEvent(eventId: string): Promise<void> {
    const [event] = await db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, eventId))
      .limit(1);
    if (!event) {
      throw new Error(`Outbox row ${eventId} not found`);
    }
    // Stale duplicate job for an already-settled event: nothing to do.
    if (event.status === "processed" || event.status === "dead") return;

    await db
      .update(domainEvents)
      .set({ attempts: sql`${domainEvents.attempts} + 1` })
      .where(eq(domainEvents.id, eventId));

    try {
      const envelope = registry.parse({
        name: event.name,
        version: event.version,
        payload: event.payload,
      });
      for (const handler of handlers.handlersFor(event.name)) {
        await db.transaction(async (tx) => {
          const claimed = await tx
            .insert(processedEvents)
            .values({ eventId, handler: handler.name })
            .onConflictDoNothing()
            .returning({ eventId: processedEvents.eventId });
          // Claim already taken → this handler already ran for this event
          // id; re-delivery is a no-op (idempotent handler registry).
          if (claimed.length === 0) return;
          await handler.fn(envelope, tx);
        });
      }
      await db
        .update(domainEvents)
        .set({ status: "processed", lastError: null })
        .where(eq(domainEvents.id, eventId));
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      await db
        .update(domainEvents)
        .set({ lastError: message.slice(0, MAX_ERROR_LENGTH) })
        .where(eq(domainEvents.id, eventId));
      throw error;
    }
  }

  async function markDead(eventId: string): Promise<void> {
    await db.update(domainEvents).set({ status: "dead" }).where(eq(domainEvents.id, eventId));
    log.error({ eventId }, "domain event dead-lettered after exhausting retries");
  }

  return {
    isStarted: () => started,
    pump,
    redeliver: processEvent,

    async start() {
      await boss.start();
      // createQueue is idempotent (ON CONFLICT DO NOTHING) — safe on restart.
      await boss.createQueue(OUTBOX_DEAD_LETTER_QUEUE, {});
      await boss.createQueue(OUTBOX_QUEUE, {
        deadLetter: OUTBOX_DEAD_LETTER_QUEUE,
        retryLimit: options.retryLimit,
        retryDelay: options.retryDelayS,
        retryBackoff: true,
      });
      await boss.work<OutboxJobData>(
        OUTBOX_QUEUE,
        { pollingIntervalSeconds: options.workerPollIntervalS },
        async (jobs) => {
          for (const job of jobs) await processEvent(job.data.eventId);
        },
      );
      await boss.work<OutboxJobData>(
        OUTBOX_DEAD_LETTER_QUEUE,
        { pollingIntervalSeconds: options.workerPollIntervalS },
        async (jobs) => {
          for (const job of jobs) await markDead(job.data.eventId);
        },
      );
      pumpTimer = setInterval(() => {
        void pump().catch((error) => log.error(error, "outbox pump failed"));
      }, options.pollIntervalMs);
      pumpTimer.unref();
      started = true;
    },

    async stop() {
      if (pumpTimer) clearInterval(pumpTimer);
      pumpTimer = undefined;
      if (started) {
        // Stay inside server.ts's 10s force-exit budget (MM-QA-001 F-12).
        await boss.stop({ graceful: true, timeout: 5_000 });
        started = false;
      }
    },
  };
}
