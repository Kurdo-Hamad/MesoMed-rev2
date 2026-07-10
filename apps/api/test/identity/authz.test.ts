import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Role } from "@mesomed/contracts/roles";
import { listPendingProvidersOutputSchema } from "@mesomed/contracts/identity";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../../src/app.js";
import { testEnv } from "../helpers.js";

/**
 * Per-procedure role-guard denial matrix for the identity router (§3.6
 * layer a, gate: "role guards enforced on protected procedures, denial
 * tested per role"). Session injected via the same test-header resolver
 * the Phase 1 authz meta-test uses; real-session integration is proven in
 * patient-auth/provider-auth suites.
 */
describe("identity router authz matrix", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString), {
      sessionResolver: (req) => {
        const header = req.headers["x-test-roles"];
        const value = Array.isArray(header) ? header[0] : header;
        if (value === undefined) return null;
        return {
          userId: "user-under-test",
          roles: value === "" ? [] : (value.split(",") as Role[]),
        };
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  function call(procedure: string, kind: "query" | "mutation", roles?: string) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (roles !== undefined) headers["x-test-roles"] = roles;
    return kind === "query"
      ? app.inject({ method: "GET", url: `/trpc/identity.${procedure}`, headers })
      : app.inject({ method: "POST", url: `/trpc/identity.${procedure}`, headers, payload: {} });
  }

  const matrix: Array<{
    procedure: string;
    kind: "query" | "mutation";
    deniedRoles: string[];
  }> = [
    { procedure: "me", kind: "query", deniedRoles: [] },
    { procedure: "claimProfile", kind: "mutation", deniedRoles: [] },
    { procedure: "completeProviderSignup", kind: "mutation", deniedRoles: [] },
    { procedure: "myProviderStatus", kind: "query", deniedRoles: ["patient", "admin"] },
    {
      procedure: "listPendingProviders",
      kind: "query",
      deniedRoles: ["patient", "doctor", "secretary"],
    },
    {
      procedure: "setProviderStatus",
      kind: "mutation",
      deniedRoles: ["patient", "doctor", "secretary"],
    },
    {
      procedure: "recoverProviderAccount",
      kind: "mutation",
      deniedRoles: ["patient", "doctor", "secretary"],
    },
    { procedure: "revokeOtherSessions", kind: "mutation", deniedRoles: [] },
  ];

  for (const { procedure, kind, deniedRoles } of matrix) {
    it(`identity.${procedure}: anonymous → 401 UNAUTHORIZED`, async () => {
      const res = await call(procedure, kind);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.data.appCode).toBe("UNAUTHORIZED");
    });

    for (const role of deniedRoles) {
      it(`identity.${procedure}: ${role} → 403 FORBIDDEN`, async () => {
        const res = await call(procedure, kind, role);
        expect(res.statusCode).toBe(403);
        expect(res.json().error.data.appCode).toBe("FORBIDDEN");
      });
    }
  }

  it("rejects out-of-contract input with 400 VALIDATION (setProviderStatus status=pending)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.setProviderStatus",
      headers: { "x-test-roles": "admin", "content-type": "application/json" },
      payload: {
        providerProfileId: "3b8e0d9e-5c3a-4f6e-9a2b-1c4d5e6f7a8b",
        status: "pending",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown provider type with 400 (completeProviderSignup)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.completeProviderSignup",
      headers: { "x-test-roles": "", "content-type": "application/json" },
      payload: { providerType: "influencer", phone: "+9647700000001" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("listPendingProviders output round-trips the contract schema", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/trpc/identity.listPendingProviders",
      headers: { "x-test-roles": "admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(() => listPendingProvidersOutputSchema.parse(res.json().result.data)).not.toThrow();
  });
});
