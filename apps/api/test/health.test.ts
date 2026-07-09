import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { loadEnv } from "../src/env.js";

/** Exercises the real composition root — not a hand-wired copy of the app
 * (MM-QA-001 F-05). */
describe("health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer(loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("tRPC health.check returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/trpc/health.check" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.data.status).toBe("ok");
  });
});
