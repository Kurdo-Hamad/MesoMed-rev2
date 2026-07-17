import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { createDb, type Db } from "../client.js";
import { runMigrations } from "../migrate.js";

/**
 * Test-database harness (MM-PLAN-001 §5 Phase 1). Each call provisions an
 * isolated, migrated Postgres 16 database and returns a handle; test files
 * create one in `beforeAll` and close it in `afterAll`. The server is
 * resolved in priority order:
 *
 * 1. `TEST_DATABASE_URL` — an already-running server (the CI pg service
 *    container). A uniquely-named database is created per call so parallel
 *    test files never share state.
 * 2. Testcontainers — when a Docker daemon is reachable, a throwaway
 *    `postgres:16-alpine` container per call.
 * 3. Embedded Postgres binaries — when there is no Docker (e.g. plain WSL);
 *    a real PG16 server in a temp dir, run as the current user.
 *
 * All three run the same real PostgreSQL major, so the outbox/pg-boss
 * integration gate is exercised identically everywhere (ADR-0003).
 */
export interface TestDatabase {
  connectionString: string;
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export interface TestDatabaseOptions {
  /** Apply the package's migrations before returning. Default true. */
  migrate?: boolean;
}

export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const server = await provisionServer();
  const handle = createDb(server.connectionString);
  if (options.migrate !== false) {
    await runMigrations(handle.db);
  }
  return {
    connectionString: server.connectionString,
    db: handle.db,
    pool: handle.pool,
    close: async () => {
      await handle.close();
      await server.teardown();
    },
  };
}

interface ProvisionedServer {
  connectionString: string;
  teardown(): Promise<void>;
}

async function provisionServer(): Promise<ProvisionedServer> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (adminUrl) return createDatabaseOn(adminUrl);
  if (dockerAvailable()) return startContainer();
  return startEmbedded();
}

function dockerAvailable(): boolean {
  return Boolean(process.env.DOCKER_HOST) || existsSync("/var/run/docker.sock");
}

/** Unique, valid PG identifier: mm_test_<hex>. */
function freshDatabaseName(): string {
  return `mm_test_${randomBytes(8).toString("hex")}`;
}

async function createDatabaseOn(adminUrl: string): Promise<ProvisionedServer> {
  const name = freshDatabaseName();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Concurrent CREATE DATABASE calls (parallel vitest files) can collide
    // on the template database; retry briefly instead of serializing files.
    for (let attempt = 1; ; attempt++) {
      try {
        await admin.query(`create database ${name}`);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < 10 && /being accessed by other users/.test(message)) {
          await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 400));
          continue;
        }
        throw error;
      }
    }
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    connectionString: url.toString(),
    teardown: async () => {
      const cleaner = new pg.Client({ connectionString: adminUrl });
      await cleaner.connect();
      try {
        await cleaner.query(`drop database if exists ${name} with (force)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}

async function startContainer(): Promise<ProvisionedServer> {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  return {
    connectionString: container.getConnectionUri(),
    teardown: async () => {
      await container.stop();
    },
  };
}

/**
 * embedded-postgres registers an async-exit-hook handler at module scope,
 * and that library hooks node's `beforeExit` with a hardcoded exit code 0:
 * a process finishing with `process.exitCode = 1` (vitest after test
 * failures) gets re-exited as 0, masking the failures from turbo and the
 * local gate whenever the embedded server runs in the MAIN vitest process —
 * exactly the web clinic harness in apps/web/test/global-setup.ts
 * (ADR-0036). The hook only exists to stop clusters a caller forgot to
 * close, and every TestDatabase here is closed explicitly by its owner's
 * teardown — so drop the `beforeExit` listener the import adds. The
 * library's SIGINT/SIGTERM hooks (correct 128+n re-exits) stay in place.
 */
export async function importEmbeddedPostgres() {
  const preexisting = new Set(process.listeners("beforeExit"));
  const mod = await import("embedded-postgres");
  for (const listener of process.listeners("beforeExit")) {
    if (!preexisting.has(listener)) process.removeListener("beforeExit", listener);
  }
  return mod;
}

async function startEmbedded(): Promise<ProvisionedServer> {
  const { default: EmbeddedPostgres } = await importEmbeddedPostgres();
  // Parallel vitest forks provision embedded servers concurrently, and an
  // ephemeral port probed as free can be re-bound by a sibling before
  // postgres binds it — postgres then exits at startup, which
  // embedded-postgres surfaces as a rejection carrying `undefined` (the
  // message-less directory/authz suite flake, ADR-0021). Two containments:
  // the port is picked AFTER initdb so the probe→bind window is
  // milliseconds instead of the whole initdb, and the initialise/start
  // cycle retries a bounded number of times with a fresh port and data dir
  // (same shape as the CREATE DATABASE collision retry above).
  for (let attempt = 1; ; attempt++) {
    const databaseDir = await mkdtemp(path.join(os.tmpdir(), "mesomed-pg-"));
    const options = {
      databaseDir,
      user: "postgres",
      password: "postgres",
      // persistent:false makes embedded-postgres delete the data dir inside
      // stop() with no retry — on Windows the lingering file locks turn that
      // into EBUSY. Keep the cluster persistent and let teardown below remove
      // the directory with backoff instead.
      persistent: true,
      // initdb inherits the OS locale; on Windows that yields WIN1252, which
      // cannot store the trilingual (ar/ckb) fixture data. Force UTF8 with the
      // locale-independent C locale so all three provisioning paths (CI pg
      // service, Testcontainers, embedded) present the same encoding.
      initdbFlags: ["--encoding=UTF8", "--no-locale"],
    };
    try {
      // The library takes the port at construction but only start() uses
      // it, so initdb runs on a throwaway instance and the real port is
      // picked just before the server that will bind it.
      await new EmbeddedPostgres({ ...options, port: 5432 }).initialise();
      const port = await freePort();
      const server = new EmbeddedPostgres({ ...options, port });
      try {
        await server.start();
      } catch (cause) {
        // start() rejects with `undefined` when postgres exits early —
        // always rethrow something a test reporter can print.
        const reason =
          cause instanceof Error ? cause.message : "postgres exited before becoming ready";
        throw new Error(
          `embedded Postgres failed to start (attempt ${attempt}, port ${port}): ${reason}`,
          { cause },
        );
      }
      return {
        connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
        teardown: async () => {
          await server.stop();
          // On Windows the postgres process releases its file locks a beat after
          // stop() resolves; plain rm throws EBUSY. fs.rm retries these
          // transient codes with linear backoff.
          await rm(databaseDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
        },
      };
    } catch (error) {
      // The handle owning cleanup is never returned on a failed attempt, so
      // remove the abandoned cluster here — failed provisioning must not
      // leak /tmp/mesomed-pg-* directories.
      await rm(databaseDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
      if (attempt >= 3) throw error;
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
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
}
