import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { MOBILE_COMPAT_CONFIG_KEY, mobileCompatSchema } from "@mesomed/config";
import { buildServer } from "../src/app.js";
import { compareVersions } from "../src/kernel/app-version.js";
import { testEnv } from "./helpers.js";

/**
 * Mobile API compatibility gate (Phase 8, MM-ARC-002 §1.3): requests
 * carrying x-app-version below the configured minimum answer the typed
 * UPGRADE_REQUIRED (HTTP 412) on every procedure; no header, no config
 * row, or a malformed header never gates (web clients send no version).
 */
describe("x-app-version compatibility gate", () => {
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

  function health(version?: string) {
    return app.inject({
      method: "GET",
      url: "/trpc/health.check",
      headers: version === undefined ? {} : { "x-app-version": version },
    });
  }

  it("passes any version while no minimum is configured", async () => {
    expect((await health("0.0.1")).statusCode).toBe(200);
  });

  it("rejects a version below the configured minimum with UPGRADE_REQUIRED (412)", async () => {
    await app.kernel.config.set(mobileCompatSchema, MOBILE_COMPAT_CONFIG_KEY, {
      minSupportedVersion: "2.1.0",
    });
    const res = await health("2.0.9");
    expect(res.statusCode).toBe(412);
    const body = res.json() as { error: { data: { appCode: string } } };
    expect(body.error.data.appCode).toBe("UPGRADE_REQUIRED");
  });

  it("passes the exact minimum, higher versions, and absent header", async () => {
    expect((await health("2.1.0")).statusCode).toBe(200);
    expect((await health("2.1.1")).statusCode).toBe(200);
    expect((await health("10.0.0")).statusCode).toBe(200);
    expect((await health()).statusCode).toBe(200);
  });

  it("fails open on a malformed version header", async () => {
    expect((await health("not-a-version")).statusCode).toBe(200);
    expect((await health("2.1")).statusCode).toBe(200);
  });

  it("compareVersions orders numerically, not lexically", () => {
    expect(compareVersions("2.10.0", "2.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.9.0", "2.10.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("x", "1.0.0")).toBeNull();
  });
});
