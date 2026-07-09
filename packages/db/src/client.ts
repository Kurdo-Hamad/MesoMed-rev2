import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/kernel.js";

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

/**
 * Client factory: one pg pool + drizzle instance per process, constructed
 * by the composition root (or the test harness) and passed down — module
 * code never creates its own connection.
 */
export function createDb(connectionString: string): DbHandle {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  let closed = false;
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
