import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

export type Db = NodePgDatabase<typeof schema>;
/** The transaction handle drizzle passes to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything a query can run on — the root client or an open transaction. */
export type DbExecutor = Db | DbTransaction;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

/** Session timeout bounds, sent as connection startup parameters (server-enforced). */
export interface DbTimeouts {
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleInTransactionSessionTimeoutMs: number;
}

/**
 * The API's pool-level timeout fallback (MM-QA-004 F-11, ADR-0045).
 * Primary enforcement is role-level on `mesomed_api` (migration 0011);
 * these hold the same bounds when DATABASE_URL logs in as another role.
 * Migrations and the test harness construct pools WITHOUT timeouts —
 * long DDL/backfill migrations must never be killed mid-deploy.
 */
export const API_DB_TIMEOUTS: DbTimeouts = {
  statementTimeoutMs: 10_000,
  lockTimeoutMs: 5_000,
  idleInTransactionSessionTimeoutMs: 30_000,
};

/**
 * Client factory: one pg pool + drizzle instance per process, constructed
 * by the composition root (or the test harness) and passed down — module
 * code never creates its own connection.
 */
export function createDb(connectionString: string, options?: { timeouts?: DbTimeouts }): DbHandle {
  const timeouts = options?.timeouts;
  const pool = new pg.Pool({
    connectionString,
    ...(timeouts
      ? {
          statement_timeout: timeouts.statementTimeoutMs,
          lock_timeout: timeouts.lockTimeoutMs,
          idle_in_transaction_session_timeout: timeouts.idleInTransactionSessionTimeoutMs,
        }
      : {}),
  });
  const db = drizzle(pool, { schema });
  let closed = false;
  // An idle pooled connection can die out-of-band (server restart; the test
  // harness stopping its embedded server while pool.end() is in flight).
  // Without a listener that's an unhandled 'error' event that crashes the
  // process even though the pool already discards the dead client (pg docs
  // require a handler). Log-and-continue before close; silent during/after
  // close, where the disconnect is the expected consequence of teardown.
  pool.on("error", (error) => {
    if (!closed) console.error("pg pool idle client error:", error.message);
  });
  return {
    db,
    pool,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await pool.end();
      } catch (error) {
        // A pool that already ended (connection loss handling, tests
        // severing it deliberately) must not crash the shutdown path;
        // anything else propagates.
        if (!(error instanceof Error && /end on pool more than once/.test(error.message))) {
          throw error;
        }
      }
    },
  };
}
