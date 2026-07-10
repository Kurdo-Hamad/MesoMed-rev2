import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "./index.js";

/**
 * Programmatic migration runner, used by the test harness and by release
 * tooling. Deliberately a separate entrypoint from the package root: the
 * API bundle imports the root (for schema + the expected-migration count)
 * but never this file — the running API asserts migrations are applied
 * (readiness), it does not apply them.
 */
const defaultMigrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(
  db: Db,
  migrationsFolder: string = defaultMigrationsFolder,
): Promise<void> {
  await migrate(db, {
    migrationsFolder,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  });
}
