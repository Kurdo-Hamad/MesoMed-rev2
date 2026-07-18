import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { systemRouter } from "../src/trpc/system.js";
import { buildBookingTestServer, trpc } from "./booking/helpers.js";

/**
 * Authz enumeration pin + denial matrix for the kernel system router
 * (§3.6 layer a; MM-QA-004 F-07): EVERY procedure must appear in the
 * matrix, so a new procedure cannot ship without denial coverage
 * (HANDOFF-001 #14). whoami is public by design (session echo); the
 * outboxStats admin guard is also the kernel guard's own meta-test
 * subject in test/authz.test.ts — this matrix pins the full surface.
 */
describe("system router authz matrix", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  interface MatrixEntry {
    procedure: string;
    kind: "query" | "mutation";
    input?: unknown;
    /** Roles denied by the kernel role guard (layer a) → 403. */
    deniedRoles: string[];
    /** Public procedures assert the absence of an auth gate instead of 401. */
    access?: "public";
  }

  const MATRIX: MatrixEntry[] = [
    { procedure: "system.whoami", kind: "query", deniedRoles: [], access: "public" },
    {
      procedure: "system.outboxStats",
      kind: "query",
      deniedRoles: ["patient", "doctor", "secretary"],
    },
  ];

  it("meta-test: EVERY system procedure appears in the denial matrix", () => {
    const record = systemRouter._def.procedures as Record<string, unknown>;
    const procedures = Object.keys(record)
      .map((name) => `system.${name}`)
      .sort();
    expect(procedures).toEqual(MATRIX.map((e) => e.procedure).sort());
  });

  for (const entry of MATRIX) {
    if (entry.access === "public") {
      it(`${entry.procedure}: public — anonymous caller is not auth-gated`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input);
        expect([401, 403]).not.toContain(res.statusCode);
      });
    } else {
      it(`${entry.procedure}: anonymous → 401 UNAUTHORIZED`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input);
        expect(res.statusCode).toBe(401);
        expect(res.json().error.data.appCode).toBe("UNAUTHORIZED");
      });
    }

    for (const role of entry.deniedRoles) {
      it(`${entry.procedure}: ${role} → 403 FORBIDDEN`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input, { roles: role });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.data.appCode).toBe("FORBIDDEN");
      });
    }
  }
});
