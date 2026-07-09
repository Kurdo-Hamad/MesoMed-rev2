import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { Role } from "@mesomed/contracts/roles";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../src/app.js";
import { testEnv } from "./helpers.js";

/**
 * Meta-test for the kernel authz middleware (MM-PLAN-001 §3.6 layer a):
 * a role-denied call must be proven to be denied. Runs through the real
 * composition root against the real admin-gated procedure
 * (system.outboxStats); only the session resolver is injected — the exact
 * seam Better Auth fills in Phase 2.
 */
describe("kernel authz role guard", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString), {
      // Test session protocol: `x-test-roles: admin,doctor` → session with
      // those roles; absent header → anonymous.
      sessionResolver: (req) => {
        const header = req.headers["x-test-roles"];
        const value = Array.isArray(header) ? header[0] : header;
        if (!value) return null;
        return { userId: "user-under-test", roles: value.split(",") as Role[] };
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("denies an anonymous call with UNAUTHORIZED (HTTP 401)", async () => {
    const res = await app.inject({ method: "GET", url: "/trpc/system.outboxStats" });
    expect(res.statusCode).toBe(401);
    const { error } = res.json();
    expect(error.data.code).toBe("UNAUTHORIZED");
    expect(error.data.appCode).toBe(ErrorCode.UNAUTHORIZED);
  });

  it("denies an authenticated call lacking the role with FORBIDDEN (HTTP 403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/trpc/system.outboxStats",
      headers: { "x-test-roles": "patient" },
    });
    expect(res.statusCode).toBe(403);
    const { error } = res.json();
    expect(error.data.code).toBe("FORBIDDEN");
    expect(error.data.appCode).toBe(ErrorCode.FORBIDDEN);
  });

  it("admits the allowed role and serves the real query", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/trpc/system.outboxStats",
      headers: { "x-test-roles": "admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.data).toEqual({
      pending: 0,
      published: 0,
      processed: 0,
      dead: 0,
    });
  });

  it("reflects the session in system.whoami", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/trpc/system.whoami",
      headers: { "x-test-roles": "doctor,secretary" },
    });
    expect(res.json().result.data).toMatchObject({
      userId: "user-under-test",
      roles: ["doctor", "secretary"],
    });
  });
});
