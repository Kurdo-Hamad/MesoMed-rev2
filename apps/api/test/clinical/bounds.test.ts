import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  listEncountersOutputSchema,
  patientClinicalHistoryOutputSchema,
  visitNotesOutputSchema,
} from "@mesomed/contracts/clinical";
import { and, clinicalAccessLog, desc, encounters, eq, gt } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  result,
  seedClinic,
  trpc,
  type CallOptions,
  type ClinicFixture,
} from "../booking/helpers.js";
import { appCode, completeAppointment, doctorSession, patientSession } from "./helpers.js";

/**
 * MM-QA-004 F-12 — clinical list bounds. The encounter lists and the
 * clinical history page their reads through the rebuilt
 * clinical_read_encounters, and THE invariant under test is that the
 * audit trail matches reality: one 'encounter_read' row per encounter
 * actually returned — never one per encounter merely matched (the
 * pre-F-12 function audited every match regardless of what was served).
 * History's notes ride in ONE bulk call with unchanged per-encounter
 * audit granularity.
 */
describe("clinical list bounds (keyset pages, audit == returned rows)", () => {
  const TOTAL = 5;

  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  /** All encounter ids ordered startsAt DESC, id ASC (the list order). */
  let orderedIds: string[] = [];
  let patientProfileId: string;
  /** The newest encounter carries three notes; the oldest carries one. */
  let notedEncounterId: string;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);
    for (let visit = 0; visit < TOTAL; visit++) {
      await completeAppointment(app, clinic);
    }
    const rows = await tdb.db
      .select({ id: encounters.id, patientProfileId: encounters.patientProfileId })
      .from(encounters)
      .orderBy(desc(encounters.startsAt), encounters.id);
    orderedIds = rows.map((row) => row.id);
    patientProfileId = rows[0]!.patientProfileId;
    notedEncounterId = orderedIds[0]!;

    for (const [encounterId, contents] of [
      [notedEncounterId, ["note one", "note two", "note three"]],
      [orderedIds[TOTAL - 1]!, ["oldest note"]],
    ] as const) {
      for (const content of contents) {
        const res = await trpc(
          app,
          "clinical.addVisitNote",
          "mutation",
          { encounterId, content },
          doctorSession(clinic),
        );
        if (res.statusCode !== 200) throw new Error(`fixture note failed: ${res.body}`);
      }
    }
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  /** Snapshot the audit high-water mark, then read only NEW rows after it. */
  async function auditMark(): Promise<number> {
    const [row] = await tdb.db
      .select({ id: clinicalAccessLog.id })
      .from(clinicalAccessLog)
      .orderBy(desc(clinicalAccessLog.id))
      .limit(1);
    return row?.id ?? 0;
  }

  async function auditSince(mark: number, actor: string, action: string) {
    return tdb.db
      .select({ id: clinicalAccessLog.id, encounterId: clinicalAccessLog.encounterId })
      .from(clinicalAccessLog)
      .where(
        and(
          gt(clinicalAccessLog.id, mark),
          eq(clinicalAccessLog.actorUserId, actor),
          eq(clinicalAccessLog.action, action),
        ),
      );
  }

  async function listPage(
    procedure: string,
    input: { limit?: number; cursor?: string } | undefined,
    session: CallOptions,
  ) {
    const res = await trpc(app, procedure, "query", input, session);
    expect(res.statusCode).toBe(200);
    return listEncountersOutputSchema.parse(result(res));
  }

  it("THE KEY INVARIANT: a limit-2 page writes exactly 2 encounter_read audit rows — the ones returned", async () => {
    const mark = await auditMark();
    const body = await listPage("clinical.doctorEncounters", { limit: 2 }, doctorSession(clinic));

    expect(body.encounters).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();

    // Pre-F-12, this call would have audited all 5 matched encounters.
    const audited = await auditSince(mark, clinic.doctorUserId, "encounter_read");
    expect(audited).toHaveLength(2);
    expect(audited.map((row) => row.encounterId).sort()).toEqual(
      body.encounters.map((e) => e.encounterId).sort(),
    );
  });

  it("walks doctorEncounters to completion: no overlap, no gap, stable startsAt DESC order", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages++) {
      const body = await listPage(
        "clinical.doctorEncounters",
        { limit: 2, ...(cursor === undefined ? {} : { cursor }) },
        doctorSession(clinic),
      );
      seen.push(...body.encounters.map((e) => e.encounterId));
      if (body.nextCursor === null) break;
      cursor = body.nextCursor;
    }
    // Pages of 2/2/1 over 5 rows — the short final page ends the walk.
    expect(seen).toEqual(orderedIds);
  });

  it("no-args call still works (optional input): default page, exact-limit nextCursor absent", async () => {
    const body = await listPage("clinical.doctorEncounters", undefined, doctorSession(clinic));
    expect(body.encounters.map((e) => e.encounterId)).toEqual(orderedIds);
    // 5 rows < the default limit of 50 — nothing more can exist.
    expect(body.nextCursor).toBeNull();
  });

  it("a malformed cursor serves page one, never an error (directory precedent)", async () => {
    const body = await listPage(
      "clinical.doctorEncounters",
      { limit: 2, cursor: "not-a-cursor" },
      doctorSession(clinic),
    );
    expect(body.encounters.map((e) => e.encounterId)).toEqual(orderedIds.slice(0, 2));
  });

  it("hard clamp: limit 999 → 400 VALIDATION", async () => {
    for (const procedure of ["clinical.doctorEncounters", "clinical.patientClinicalHistory"]) {
      const res = await trpc(
        app,
        procedure,
        "query",
        { patientProfileId, limit: 999 },
        doctorSession(clinic),
      );
      expect(res.statusCode).toBe(400);
      expect(appCode(res)).toBe("VALIDATION");
    }
  });

  it("myEncounters pages identically and audits only the returned rows", async () => {
    const mark = await auditMark();
    const body = await listPage("clinical.myEncounters", { limit: 3 }, patientSession(clinic));

    expect(body.encounters.map((e) => e.encounterId)).toEqual(orderedIds.slice(0, 3));
    expect(body.nextCursor).not.toBeNull();

    const audited = await auditSince(mark, clinic.patientUserId, "encounter_read");
    expect(audited).toHaveLength(3);

    const rest = await listPage(
      "clinical.myEncounters",
      { limit: 3, cursor: body.nextCursor! },
      patientSession(clinic),
    );
    expect(rest.encounters.map((e) => e.encounterId)).toEqual(orderedIds.slice(3));
    expect(rest.nextCursor).toBeNull();
  });

  it("patientClinicalHistory pages encounters, groups the page's notes, and audits per page only", async () => {
    const mark = await auditMark();
    const res = await trpc(
      app,
      "clinical.patientClinicalHistory",
      "query",
      { patientProfileId, limit: 2 },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = patientClinicalHistoryOutputSchema.parse(result(res));

    expect(body.encounters.map((e) => e.encounterId)).toEqual(orderedIds.slice(0, 2));
    expect(body.nextCursor).not.toBeNull();

    // Note groups exist for exactly the page's encounters, contents grouped
    // correctly (the newest encounter holds the three fixture notes).
    expect(body.visitNotes.map((group) => group.encounterId)).toEqual(orderedIds.slice(0, 2));
    const notedGroup = body.visitNotes.find((group) => group.encounterId === notedEncounterId);
    expect(notedGroup!.notes.map((n) => n.content)).toEqual(["note one", "note two", "note three"]);

    // Audit: 2 encounter reads + 2 notes reads (one per PAGE encounter),
    // exactly — the former N+1 loop audited one notes_read per encounter
    // of the WHOLE history.
    const encounterReads = await auditSince(mark, clinic.doctorUserId, "encounter_read");
    expect(encounterReads.map((row) => row.encounterId).sort()).toEqual(
      orderedIds.slice(0, 2).sort(),
    );
    const notesReads = await auditSince(mark, clinic.doctorUserId, "notes_read");
    expect(notesReads.map((row) => row.encounterId).sort()).toEqual(orderedIds.slice(0, 2).sort());
  });

  it("patientClinicalHistory walked to completion matches the unpaged view (N+1 gone, output preserved)", async () => {
    const full = patientClinicalHistoryOutputSchema.parse(
      result(
        await trpc(
          app,
          "clinical.patientClinicalHistory",
          "query",
          { patientProfileId },
          doctorSession(clinic),
        ),
      ),
    );
    expect(full.encounters.map((e) => e.encounterId)).toEqual(orderedIds);
    expect(full.visitNotes.map((group) => group.encounterId)).toEqual(orderedIds);
    expect(full.nextCursor).toBeNull();

    const walkedNotes: (typeof full.visitNotes)[number][] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages++) {
      const body = patientClinicalHistoryOutputSchema.parse(
        result(
          await trpc(
            app,
            "clinical.patientClinicalHistory",
            "query",
            { patientProfileId, limit: 2, ...(cursor === undefined ? {} : { cursor }) },
            doctorSession(clinic),
          ),
        ),
      );
      walkedNotes.push(...body.visitNotes);
      if (body.nextCursor === null) break;
      cursor = body.nextCursor;
    }
    expect(walkedNotes).toEqual(full.visitNotes);
  });

  it("encounterNotes applies its cap app-side; audit stays one notes_read per call", async () => {
    const mark = await auditMark();
    const res = await trpc(
      app,
      "clinical.encounterNotes",
      "query",
      { encounterId: notedEncounterId, limit: 2 },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = visitNotesOutputSchema.parse(result(res));
    expect(body.notes.map((n) => n.content)).toEqual(["note one", "note two"]);

    const notesReads = await auditSince(mark, clinic.doctorUserId, "notes_read");
    expect(notesReads).toHaveLength(1);
    // The layer-b encounter load remains a single audited encounter read.
    const encounterReads = await auditSince(mark, clinic.doctorUserId, "encounter_read");
    expect(encounterReads).toHaveLength(1);
  });

  it("encounterNotes without a limit still returns every note (default IS the cap)", async () => {
    const res = await trpc(
      app,
      "clinical.encounterNotes",
      "query",
      { encounterId: notedEncounterId },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = visitNotesOutputSchema.parse(result(res));
    expect(body.notes).toHaveLength(3);
  });
});
