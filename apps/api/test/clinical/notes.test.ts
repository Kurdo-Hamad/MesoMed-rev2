import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { visitNotesOutputSchema } from "@mesomed/contracts/clinical";
import { and, clinicalAccessLog, domainEvents, eq, sql, visitNotes } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";
import { appCode, completeAppointment, doctorSession, patientSession } from "./helpers.js";

/**
 * Phase 5 gate — the append-only amendments model (§3.5): original content
 * immutable (asserted at the DB layer, not just the app layer), amendments
 * append as new rows, history reads back in order, and note content never
 * leaks into event payloads.
 */
describe("visit notes: append-only amendments", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let encounterId: string;
  let originalNoteId: string;
  let amendmentId: string;

  const ORIGINAL_CONTENT = "BP 120/80. Prescribed amoxicillin 500mg.";
  const AMENDED_CONTENT = "Correction: amoxicillin 250mg, not 500mg.";
  const SECOND_CONTENT = "Follow-up scheduled in two weeks.";

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
    clinic = await seedClinic(app);
    ({ encounterId } = await completeAppointment(app, clinic));
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("owning doctor adds a note; the DB trigger logs note_added", async () => {
    const res = await trpc(
      app,
      "clinical.addVisitNote",
      "mutation",
      { encounterId, content: ORIGINAL_CONTENT },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    originalNoteId = result<{ visitNoteId: string }>(res).visitNoteId;

    const audit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.visitNoteId, originalNoteId),
          eq(clinicalAccessLog.action, "note_added"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(clinic.doctorUserId);
  });

  it("amendment appends a new row and the original content is untouched", async () => {
    const res = await trpc(
      app,
      "clinical.amendVisitNote",
      "mutation",
      { encounterId, visitNoteId: originalNoteId, content: AMENDED_CONTENT },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = result<{ visitNoteId: string; amendsNoteId: string | null }>(res);
    amendmentId = body.visitNoteId;
    expect(body.amendsNoteId).toBe(originalNoteId);
    expect(amendmentId).not.toBe(originalNoteId);

    const [original] = await tdb.db
      .select()
      .from(visitNotes)
      .where(eq(visitNotes.id, originalNoteId));
    expect(original!.content).toBe(ORIGINAL_CONTENT);

    const audit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.visitNoteId, amendmentId),
          eq(clinicalAccessLog.action, "note_amended"),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it("history reads back in order: original, its amendment, later notes", async () => {
    const second = await trpc(
      app,
      "clinical.addVisitNote",
      "mutation",
      { encounterId, content: SECOND_CONTENT },
      doctorSession(clinic),
    );
    expect(second.statusCode).toBe(200);

    const res = await trpc(
      app,
      "clinical.encounterNotes",
      "query",
      { encounterId },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = visitNotesOutputSchema.parse(result(res));
    expect(body.notes.map((n) => n.content)).toEqual([
      ORIGINAL_CONTENT,
      AMENDED_CONTENT,
      SECOND_CONTENT,
    ]);
    expect(body.notes[1]!.amendsNoteId).toBe(originalNoteId);

    const reads = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.encounterId, encounterId),
          eq(clinicalAccessLog.action, "notes_read"),
        ),
      );
    expect(reads.length).toBeGreaterThan(0);
  });

  it("patient reads their own notes through the same audited channel", async () => {
    const res = await trpc(
      app,
      "clinical.encounterNotes",
      "query",
      { encounterId },
      patientSession(clinic),
    );
    expect(res.statusCode).toBe(200);
    const body = visitNotesOutputSchema.parse(result(res));
    expect(body.notes).toHaveLength(3);
  });

  it("amending an amendment is rejected with a typed error", async () => {
    const res = await trpc(
      app,
      "clinical.amendVisitNote",
      "mutation",
      { encounterId, visitNoteId: amendmentId, content: "chain attempt" },
      doctorSession(clinic),
    );
    expect(res.statusCode).toBe(400);
    expect(appCode(res)).toBe("VALIDATION");
  });

  it("DB layer: UPDATE on visit note content is blocked even for the table owner", async () => {
    await expect(
      tdb.pool.query("update visit_notes set content = 'tampered' where id = $1", [originalNoteId]),
    ).rejects.toThrow(/CLINICAL_APPEND_ONLY/);
    await expect(
      tdb.pool.query("delete from visit_notes where id = $1", [originalNoteId]),
    ).rejects.toThrow(/CLINICAL_APPEND_ONLY/);

    const [original] = await tdb.db
      .select()
      .from(visitNotes)
      .where(eq(visitNotes.id, originalNoteId));
    expect(original!.content).toBe(ORIGINAL_CONTENT);
  });

  it("DB layer: the amend-target invariant holds without the app pre-check", async () => {
    // Call the channel directly (as the harness superuser), bypassing the
    // application layer entirely: amendments may not target amendments.
    await expect(
      tdb.pool.query("select clinical_add_visit_note($1, $2, $3, $4)", [
        encounterId,
        amendmentId,
        "rogue",
        "chained amendment",
      ]),
    ).rejects.toThrow(/CLINICAL_AMEND_TARGET_INVALID/);
  });

  it("privacy: note content never appears in domain_events payloads", async () => {
    const rows = await tdb.db
      .select({ payload: domainEvents.payload })
      .from(domainEvents)
      .where(sql`${domainEvents.payload}::text like ${"%amoxicillin%"}`);
    expect(rows).toHaveLength(0);

    const noteEvents = await tdb.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.name, "clinical.visit_note_added.v1"));
    expect(noteEvents.length).toBeGreaterThanOrEqual(3);
  });
});
