import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AiGateway } from "@mesomed/platform";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { createAiRouter } from "../../src/modules/ai/router.js";
import { buildBookingTestServer, trpc } from "../booking/helpers.js";

/**
 * Authz enumeration pin for the ai router (§3.6 layer a; MM-QA-004 F-07):
 * EVERY procedure must appear in the matrix, so a new procedure cannot
 * ship without denial coverage (HANDOFF-001 #14). triageSymptoms is public
 * by design (guest triage before booking) — the pin proves the surface is
 * exactly that one public procedure, and the public assertion proves no
 * auth gate fires on it (rate-limit behavior is proven in ai/router.test.ts).
 */
describe("ai router authz matrix", () => {
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
    {
      procedure: "ai.triageSymptoms",
      kind: "mutation",
      input: { text: "headache and mild fever" },
      deniedRoles: [],
      access: "public",
    },
  ];

  it("meta-test: EVERY ai procedure appears in the denial matrix", () => {
    // Router construction only wires closures — enumeration stubs are safe.
    const record = createAiRouter({ ai: {} as AiGateway })._def.procedures as Record<
      string,
      unknown
    >;
    const procedures = Object.keys(record)
      .map((name) => `ai.${name}`)
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
