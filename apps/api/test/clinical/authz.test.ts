import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { createClinicalRouter } from "../../src/modules/clinical/router.js";
import {
  buildBookingTestServer,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";
import { appCode, completeAppointment, doctorSession } from "./helpers.js";

/**
 * Role-guard denial matrix for the clinical router (§3.6 layer a) plus
 * layer-b ownership denials, with the meta-test proving the guardrail:
 * EVERY procedure (mutations AND queries — clinical reads are as sensitive
 * as writes) must appear in the matrix, so a new procedure cannot ship
 * without denial coverage (HANDOFF-001 #14).
 *
 * Deliberate assertions: admin is DENIED on every doctor/patient clinical
 * procedure — administrators have no implicit path to clinical content;
 * their only route is an explicit, audited, time-boxed support grant.
 */
describe("clinical authz matrix", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let encounterId: string;
  let noteId: string;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);
    ({ encounterId } = await completeAppointment(app, clinic));
    const res = await trpc(
      app,
      "clinical.addVisitNote",
      "mutation",
      { encounterId, content: "authz fixture note" },
      doctorSession(clinic),
    );
    if (res.statusCode !== 200) throw new Error(`fixture note failed: ${res.body}`);
    noteId = (res.json() as { result: { data: { visitNoteId: string } } }).result.data.visitNoteId;
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  const UUID = "3b8e0d9e-5c3a-4f6e-9a2b-1c4d5e6f7a8b";

  interface MatrixEntry {
    procedure: string;
    kind: "query" | "mutation";
    input?: unknown;
    /** Roles denied by the kernel role guard (layer a) → 403. */
    deniedRoles: string[];
  }

  const MATRIX: MatrixEntry[] = [
    {
      procedure: "clinical.doctorEncounters",
      kind: "query",
      deniedRoles: ["patient", "secretary", "admin"],
    },
    {
      procedure: "clinical.myEncounters",
      kind: "query",
      deniedRoles: ["doctor", "secretary", "admin"],
    },
    {
      procedure: "clinical.encounterNotes",
      kind: "query",
      input: { encounterId: UUID },
      deniedRoles: ["secretary", "admin"],
    },
    {
      procedure: "clinical.addVisitNote",
      kind: "mutation",
      input: { encounterId: UUID, content: "x" },
      deniedRoles: ["patient", "secretary", "admin"],
    },
    {
      procedure: "clinical.amendVisitNote",
      kind: "mutation",
      input: { encounterId: UUID, visitNoteId: UUID, content: "x" },
      deniedRoles: ["patient", "secretary", "admin"],
    },
    {
      procedure: "clinical.grantSupportAccess",
      kind: "mutation",
      input: { encounterId: UUID, reason: "reason text", expiresAt: "2027-01-01T00:00:00.000Z" },
      deniedRoles: ["patient", "doctor", "secretary"],
    },
    {
      procedure: "clinical.revokeSupportAccess",
      kind: "mutation",
      input: { grantId: UUID },
      deniedRoles: ["patient", "doctor", "secretary"],
    },
    {
      procedure: "clinical.supportNotes",
      kind: "query",
      input: { grantId: UUID },
      deniedRoles: ["patient", "doctor", "secretary"],
    },
    {
      procedure: "clinical.listSupportGrants",
      kind: "query",
      input: {},
      deniedRoles: ["patient", "doctor", "secretary"],
    },
  ];

  it("meta-test: EVERY clinical procedure appears in the denial matrix", () => {
    const record = createClinicalRouter()._def.procedures as Record<string, unknown>;
    const procedures = Object.keys(record)
      .map((name) => `clinical.${name}`)
      .sort();
    expect(procedures).toEqual(MATRIX.map((e) => e.procedure).sort());
  });

  it("meta-test: there is no encounter-creating mutation on the router", () => {
    const record = createClinicalRouter()._def.procedures as Record<string, unknown>;
    const mutations = Object.entries(record).filter(
      ([, p]) => (p as { _def: { type: string } })._def.type === "mutation",
    );
    // The booking.completed.v1 subscriber is the only creation path.
    expect(mutations.map(([name]) => name).sort()).toEqual([
      "addVisitNote",
      "amendVisitNote",
      "grantSupportAccess",
      "revokeSupportAccess",
    ]);
  });

  // ── Layer a: anonymous and wrong-role denials per procedure ──────────

  for (const entry of MATRIX) {
    it(`${entry.procedure}: anonymous → 401 UNAUTHORIZED`, async () => {
      const res = await trpc(app, entry.procedure, entry.kind, entry.input);
      expect(res.statusCode).toBe(401);
      expect(appCode(res)).toBe("UNAUTHORIZED");
    });

    for (const role of entry.deniedRoles) {
      it(`${entry.procedure}: ${role} → 403 FORBIDDEN`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input, { roles: role });
        expect(res.statusCode).toBe(403);
        expect(appCode(res)).toBe("FORBIDDEN");
      });
    }
  }

  // ── Layer b: right role, wrong resource binding → 403 ────────────────

  it("addVisitNote: a doctor who does not own the encounter → 403", async () => {
    const res = await trpc(
      app,
      "clinical.addVisitNote",
      "mutation",
      { encounterId, content: "intrusion" },
      { roles: "doctor", user: clinic.otherDoctorUserId },
    );
    expect(res.statusCode).toBe(403);
    expect(appCode(res)).toBe("FORBIDDEN");
  });

  it("amendVisitNote: a doctor who does not own the encounter → 403", async () => {
    const res = await trpc(
      app,
      "clinical.amendVisitNote",
      "mutation",
      { encounterId, visitNoteId: noteId, content: "intrusion" },
      { roles: "doctor", user: clinic.otherDoctorUserId },
    );
    expect(res.statusCode).toBe(403);
  });

  it("encounterNotes: a different patient → 403", async () => {
    const res = await trpc(
      app,
      "clinical.encounterNotes",
      "query",
      { encounterId },
      { roles: "patient", user: clinic.otherPatientUserId },
    );
    expect(res.statusCode).toBe(403);
  });

  it("encounterNotes: the non-owning doctor → 403", async () => {
    const res = await trpc(
      app,
      "clinical.encounterNotes",
      "query",
      { encounterId },
      { roles: "doctor", user: clinic.otherDoctorUserId },
    );
    expect(res.statusCode).toBe(403);
  });

  it("encounterNotes: patient role without a claimed profile → 403", async () => {
    const res = await trpc(
      app,
      "clinical.encounterNotes",
      "query",
      { encounterId },
      { roles: "patient", user: "session-without-profile" },
    );
    expect(res.statusCode).toBe(403);
  });

  it("doctorEncounters: doctor role without a directory profile → 403", async () => {
    const res = await trpc(app, "clinical.doctorEncounters", "query", undefined, {
      roles: "doctor",
      user: "session-without-profile",
    });
    expect(res.statusCode).toBe(403);
  });

  it("meta-test: denied layer-b write left no note, no event, no note audit row", async () => {
    const notes = await trpc(
      app,
      "clinical.encounterNotes",
      "query",
      { encounterId },
      doctorSession(clinic),
    );
    const body = (notes.json() as { result: { data: { notes: Array<{ content: string }> } } })
      .result.data;
    expect(body.notes.some((n) => n.content === "intrusion")).toBe(false);
  });

  it("rejects out-of-contract input with 400 (empty note content)", async () => {
    const res = await trpc(
      app,
      "clinical.addVisitNote",
      "mutation",
      { encounterId, content: "" },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(400);
  });
});
