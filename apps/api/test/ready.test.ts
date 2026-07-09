import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../src/app.js";
import { testEnv } from "./helpers.js";

/**
 * Liveness/readiness gate (MM-QA-001 F-13): /ready reports Postgres
 * reachability, applied migrations, and the dispatcher; when Postgres
 * becomes unreachable, /ready must flip to 503 while /health (liveness)
 * keeps answering 200 — the orchestrator restarts on liveness, so it must
 * not follow readiness down.
 *
 * Ordering matters: the pg-outage test kills the app's pool, so it runs
 * last and `afterAll` tolerates the broken state.
 */
describe("readiness", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("answers ready with all checks green on a migrated database", async () => {
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.checks).toEqual([
      { name: "postgres", ok: true },
      { name: "migrations", ok: true },
      { name: "dispatcher", ok: true },
    ]);
  });

  it("flips to 503 when Postgres becomes unreachable — while /health stays 200", async () => {
    // Sever the app's database pool: every readiness probe now fails the
    // same way it would if Postgres went down.
    await app.kernel.pool.end();

    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(503);
    const body = ready.json();
    expect(body.status).toBe("unavailable");
    expect(body.checks.find((c: { name: string }) => c.name === "postgres")?.ok).toBe(false);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe("ok");
  });
});
