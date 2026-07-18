import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { createCommunicationRouter } from "../../src/modules/communication/router.js";
import { buildBookingTestServer, trpc } from "../booking/helpers.js";

/**
 * Per-procedure role-guard denial matrix for the communication router
 * (§3.6 layer a; MM-QA-004 F-07/F-19) with the enumeration pin proving the
 * guardrail itself: EVERY procedure must appear in the matrix, so a new
 * procedure cannot ship without denial coverage (HANDOFF-001 #14).
 * Layer-b is session-bound by construction here (every handler keys on
 * ctx.session.userId; no resource id in any input) — ownership isolation
 * is proven in communication/router.test.ts.
 */
describe("communication router authz matrix", () => {
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
  }

  // authenticatedProcedure entries carry deniedRoles: [] — any role is
  // admitted, so only the anonymous → 401 gate applies.
  const MATRIX: MatrixEntry[] = [
    { procedure: "communication.registerDeviceToken", kind: "mutation", deniedRoles: [] },
    { procedure: "communication.unregisterDeviceToken", kind: "mutation", deniedRoles: [] },
    { procedure: "communication.setChannelPreferences", kind: "mutation", deniedRoles: [] },
    { procedure: "communication.getChannelPreferences", kind: "query", deniedRoles: [] },
    {
      procedure: "communication.listRecentNotifications",
      kind: "query",
      deniedRoles: ["patient", "doctor", "secretary"],
    },
  ];

  it("meta-test: EVERY communication procedure appears in the denial matrix", () => {
    const record = createCommunicationRouter()._def.procedures as Record<string, unknown>;
    const procedures = Object.keys(record)
      .map((name) => `communication.${name}`)
      .sort();
    expect(procedures).toEqual(MATRIX.map((e) => e.procedure).sort());
  });

  for (const entry of MATRIX) {
    it(`${entry.procedure}: anonymous → 401 UNAUTHORIZED`, async () => {
      const res = await trpc(app, entry.procedure, entry.kind, entry.input);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.data.appCode).toBe("UNAUTHORIZED");
    });

    for (const role of entry.deniedRoles) {
      it(`${entry.procedure}: ${role} → 403 FORBIDDEN`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input, { roles: role });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.data.appCode).toBe("FORBIDDEN");
      });
    }
  }
});
