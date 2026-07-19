import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { runMigrations } from "@mesomed/db/migrate";
import { assertSchemaCurrent } from "../../scripts/seed/preflight.js";
import { seedDirectory } from "../../scripts/seed/seed-directory.js";
import { buildDirectoryTestServer } from "./helpers.js";

const MIGRATIONS_SOURCE = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);

/** A copy of the shipped migrations with the last one removed. */
async function migrationsMinusLatest(): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mesomed-behind-"));
  await cp(MIGRATIONS_SOURCE, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const dropped = journal.entries.pop();
  if (dropped === undefined) throw new Error("migration journal is empty");
  await rm(path.join(folder, `${dropped.tag}.sql`));
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}

describe("seed schema preflight", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let folder: string;

  beforeAll(async () => {
    folder = await migrationsMinusLatest();
    tdb = await createTestDatabase({ migrate: false });
    await runMigrations(tdb.db, folder);
    app = await buildDirectoryTestServer(tdb.connectionString);
    await app.ready();
  }, 300_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
    await rm(folder, { recursive: true, force: true });
  });

  it("diagnoses a behind-schema database instead of failing deep in the seed", async () => {
    const { db, config, outbox } = app.kernel;
    // The entrypoint's order: preflight, then seed.
    const run = async () => {
      await assertSchemaCurrent(db);
      await seedDirectory({ db, config, outbox });
    };
    await expect(run()).rejects.toThrow(/migrations applied.*db:migrate/s);
  });

  it("names the remedy for a database that was never migrated at all", async () => {
    // The migrations table itself is absent — the operator who skipped the
    // migrate step entirely must still be told what to run.
    const fresh = await createTestDatabase({ migrate: false });
    try {
      await expect(assertSchemaCurrent(fresh.db)).rejects.toThrow(/0 of \d+.*db:migrate/s);
    } finally {
      await fresh.close();
    }
  }, 300_000);

  it("leaves a current database alone", async () => {
    await runMigrations(tdb.db);
    await expect(assertSchemaCurrent(app.kernel.db)).resolves.toBeUndefined();
  });
});
