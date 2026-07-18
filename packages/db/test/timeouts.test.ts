import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";
import { createDb, sql } from "../src/index.js";

/**
 * MM-QA-004 F-11 (ADR-0045): statement/lock/idle-in-transaction bounds.
 * Layer 1 — role-level GUCs on mesomed_api (migration 0011), asserted
 * from the catalog. Layer 2 — pool-level connection parameters for
 * whatever role the API logs in as, proven LIVE by an actual
 * statement-timeout cancellation (not just SHOW).
 */
describe("db timeouts (MM-QA-004 F-11)", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  });

  afterAll(async () => {
    await tdb.close();
  });

  it("migration 0011 pins the three role-level GUCs on mesomed_api", async () => {
    const result = await tdb.db.execute(
      sql`select rolconfig from pg_roles where rolname = 'mesomed_api'`,
    );
    const config = (result.rows[0]?.["rolconfig"] ?? []) as string[];
    expect(config).toEqual(
      expect.arrayContaining([
        "statement_timeout=10s",
        "lock_timeout=5s",
        "idle_in_transaction_session_timeout=30s",
      ]),
    );
  });

  it("pool-level timeouts are live: a long statement is actually cancelled", async () => {
    const handle = createDb(tdb.connectionString, {
      timeouts: {
        statementTimeoutMs: 200,
        lockTimeoutMs: 100,
        idleInTransactionSessionTimeoutMs: 1000,
      },
    });
    try {
      const shown = await handle.db.execute(sql`show statement_timeout`);
      expect(shown.rows[0]).toEqual({ statement_timeout: "200ms" });
      // Drizzle wraps the pg error; the cancellation cause is what matters.
      const failure = await handle.db
        .execute(sql`select pg_sleep(2)`)
        .then(() => null)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      const cause = (failure as Error).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toMatch(/statement timeout/);
    } finally {
      await handle.close();
    }
  });

  it("a pool without the option carries no session timeouts (migrations stay uncapped)", async () => {
    const shown = await tdb.db.execute(sql`show statement_timeout`);
    expect(shown.rows[0]).toEqual({ statement_timeout: "0" });
  });
});
