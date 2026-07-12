/**
 * Cron job scheduler (MM-PLAN-001 §5 Phase 7): a pg-boss instance with
 * `schedule: true`, separate from the outbox dispatcher's queue instance
 * (different `schedule` flag — pg-boss requires an explicit opt-in for
 * its pg_cron-backed scheduling). Used for the next-day reminder job.
 */
import { PgBoss } from "pg-boss";
import type { FastifyBaseLogger } from "fastify";

export interface JobScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Register a job handler for a cron-scheduled queue. */
  schedule(name: string, cron: string, handler: () => Promise<void>): Promise<void>;
}

export function createJobScheduler(options: {
  connectionString: string;
  log: FastifyBaseLogger;
}): JobScheduler {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    migrate: true,
    supervise: true,
    schedule: true,
  });
  boss.on("error", (error) => options.log.error(error, "pg-boss cron scheduler error"));

  let started = false;

  return {
    async start() {
      await boss.start();
      started = true;
    },
    async stop() {
      if (!started) return;
      await boss.stop({ graceful: true, timeout: 5_000 });
      started = false;
    },
    async schedule(name, cron, handler) {
      await boss.createQueue(name, {});
      await boss.schedule(name, cron, {});
      await boss.work(name, async (jobs) => {
        for (const _job of jobs) await handler();
      });
    },
  };
}
