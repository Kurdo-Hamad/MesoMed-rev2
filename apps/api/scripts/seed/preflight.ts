/**
 * Seed preflight (ADR-0056). The seed writes through the real commands, so
 * a database behind this build's migrations fails deep into execution with
 * a raw Postgres constraint error that reads like a code bug. Compare the
 * applied migration count against the expected one — the same check the
 * readiness probe runs (src/kernel/health.ts) — before any write, and name
 * the remedy.
 */
import {
  type Db,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  expectedMigrationCount,
  sql,
} from "@mesomed/db";

/** Zero when the database was never migrated: the table itself is absent. */
async function appliedMigrationCount(db: Db): Promise<number> {
  const present = await db.execute<{ table: string | null }>(
    sql`select to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`})::text as table`,
  );
  if (present.rows[0]?.table === null) return 0;
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count
        from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`,
  );
  return result.rows[0]?.count ?? 0;
}

export async function assertSchemaCurrent(db: Db): Promise<void> {
  const applied = await appliedMigrationCount(db);
  if (applied < expectedMigrationCount) {
    throw new Error(
      `Database is behind this build: ${applied} of ${expectedMigrationCount} expected migrations applied. ` +
        "Run `pnpm --filter @mesomed/db db:migrate` against it before seeding.",
    );
  }
}
