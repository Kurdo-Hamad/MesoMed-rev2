import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createDb } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";

/**
 * Regression test for the cluster-wide CREATE ROLE race (CI run
 * 29398795882): migration 0004 guards `mesomed_api` with an existence
 * check that was not atomic with the CREATE, so parallel test files each
 * migrating their own database on ONE shared cluster could both pass the
 * check — the loser died on pg_authid_rolname_index. The guard now
 * catches duplicate_object/unique_violation around exactly the one
 * CREATE (an advisory lock was tried and disproven: lock keyspaces are
 * per-database, and each migrator runs in its own database).
 *
 * This suite deliberately IGNORES TEST_DATABASE_URL and spins a private
 * embedded cluster: the race exists only while the role does not exist
 * yet, and the shared CI service cluster may already carry it from a
 * sibling suite — a shared-cluster version of this test would silently
 * turn vacuous. A virgin cluster makes the reproduction deterministic on
 * every path (7 of 8 migrators failed here before the fix).
 */
describe("cluster-wide role creation under concurrent migrators", () => {
  const MIGRATORS = 8;
  let databaseDir: string;
  let port: number;
  let server: { stop(): Promise<void> } | undefined;

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    databaseDir = await mkdtemp(path.join(os.tmpdir(), "mesomed-pg-race-"));
    port = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, () => {
        const address = probe.address();
        if (address === null || typeof address === "string") {
          probe.close(() => reject(new Error("Could not determine a free port")));
          return;
        }
        probe.close(() => resolve(address.port));
      });
    });
    const embedded = new EmbeddedPostgres({
      databaseDir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--no-locale"],
    });
    await embedded.initialise();
    await embedded.start();
    server = embedded;
  });

  afterAll(async () => {
    await server?.stop();
    await rm(databaseDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  });

  it("concurrent migration batches on one virgin cluster all succeed", async () => {
    const admin = new pg.Client({
      connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    });
    await admin.connect();
    const names: string[] = [];
    try {
      for (let i = 0; i < MIGRATORS; i++) {
        const name = `race_${i}`;
        await admin.query(`create database ${name}`);
        names.push(name);
      }
    } finally {
      await admin.end();
    }

    const results = await Promise.allSettled(
      names.map(async (name) => {
        const handle = createDb(`postgresql://postgres:postgres@127.0.0.1:${port}/${name}`);
        try {
          await runMigrations(handle.db);
        } finally {
          await handle.close();
        }
      }),
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => String(result.reason));
    expect(failures).toEqual([]);
    // Generous timeout: eight full migration batches racing on one
    // embedded cluster, potentially serialized at the pg_authid insert.
  }, 120_000);
});
