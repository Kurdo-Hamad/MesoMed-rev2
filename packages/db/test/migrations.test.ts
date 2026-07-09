import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  domainEvents,
  expectedMigrationCount,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
} from "../src/index.js";
import { runMigrations } from "../src/migrate.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

describe("migration runner + test harness", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  });

  afterAll(async () => {
    await tdb.close();
  });

  it("applies the kernel migrations to a fresh database", async () => {
    const { rows } = await tdb.pool.query<{ name: string | null }>(
      `select to_regclass('public.domain_events')::text as name
       union all select to_regclass('public.processed_events')::text
       union all select to_regclass('public.config_entries')::text`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      "domain_events",
      "processed_events",
      "config_entries",
    ]);
  });

  it("records exactly the journal's migrations where the readiness check looks", async () => {
    const { rows } = await tdb.pool.query<{ count: string }>(
      `select count(*) as count from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
    );
    expect(Number(rows[0]?.count)).toBe(expectedMigrationCount);
    expect(expectedMigrationCount).toBeGreaterThan(0);
  });

  it("is idempotent on re-run", async () => {
    await runMigrations(tdb.db);
    const { rows } = await tdb.pool.query<{ count: string }>(
      `select count(*) as count from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
    );
    expect(Number(rows[0]?.count)).toBe(expectedMigrationCount);
  });

  it("gives outbox rows their declared defaults", async () => {
    const [row] = await tdb.db
      .insert(domainEvents)
      .values({
        name: "test.defaults_checked.v1",
        version: 1,
        aggregateType: "test",
        aggregateId: "t-1",
        payload: {},
      })
      .returning();
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
    expect(row?.publishedAt).toBeNull();
    expect(row?.occurredAt).toBeInstanceOf(Date);
  });

  it("rejects an out-of-vocabulary outbox status at the database level", async () => {
    await expect(
      tdb.pool.query(
        `insert into domain_events (name, version, aggregate_type, aggregate_id, payload, status)
         values ('test.bad_status.v1', 1, 'test', 't-2', '{}', 'exploded')`,
      ),
    ).rejects.toThrow(/domain_events_status_check/);
  });
});
