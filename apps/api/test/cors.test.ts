import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { loadEnv } from "../src/env.js";

const ALLOWED = "https://app.example.test";
const DISALLOWED = "https://evil.example.test";

/** Meta-test for MM-QA-001 F-04: the CORS allowlist must demonstrably fire
 * — an inert CORS layer blocked every browser client in Phase 0. */
describe("cors", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer(
      loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent", CORS_ORIGINS: ` ${ALLOWED} ` }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns Access-Control-Allow-Origin plus credentials for an allowlisted origin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/trpc/health.check",
      headers: { origin: ALLOWED },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("answers preflight for an allowlisted origin", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/trpc/health.check",
      headers: { origin: ALLOWED, "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("never reflects a non-allowlisted origin (cookie-credential safety, ADR-0002)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/trpc/health.check",
      headers: { origin: DISALLOWED },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
