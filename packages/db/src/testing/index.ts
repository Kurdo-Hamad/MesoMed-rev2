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

async function startEmbedded(): Promise<ProvisionedServer> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const databaseDir = await mkdtemp(path.join(os.tmpdir(), "mesomed-pg-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  await server.initialise();
  await server.start();
  return {
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    teardown: async () => {
      await server.stop();
      await rm(databaseDir, { recursive: true, force: true });
    },
  };
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
