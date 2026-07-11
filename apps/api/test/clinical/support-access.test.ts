import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { listSupportGrantsOutputSchema, visitNotesOutputSchema } from "@mesomed/contracts/clinical";
import { and, clinicalAccessLog, eq } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  result,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";
import { ADMIN_USER, appCode, completeAppointment, doctorSession } from "./helpers.js";

/**
 * Phase 5 gate — time-boxed admin support access (§3.5): content is
 * reachable only through an explicit reasoned grant; creation, revocation
 * and every use are audited; expiry is enforced IN THE DATABASE, proven by
 * a time-controlled test that succeeds inside the window and fails after.
 */
describe("support-access grants", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let encounterId: string;

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
      { encounterId, content: "Support-visible clinical note." },
      doctorSession(clinic),
    );
    if (res.statusCode !== 200) throw new Error(`fixture note failed: ${res.body}`);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  function grant(expiresInMs: number, session = ADMIN_USER) {
    return trpc(
      app,
      "clinical.grantSupportAccess",
      "mutation",
      {
        encounterId,
        reason: "User complaint #4711 — verifying note history",
        expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      },
      session,
    );
  }

  it("grant → read works inside the window, and both are audited", async () => {
    const created = await grant(60_000);
    expect(created.statusCode).toBe(200);
    const { grantId } = result<{ grantId: string }>(created);

    const createdAudit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(eq(clinicalAccessLog.grantId, grantId), eq(clinicalAccessLog.action, "grant_created")),
      );
    expect(createdAudit).toHaveLength(1);
    expect(createdAudit[0]!.actorUserId).toBe(ADMIN_USER.user);

    const read = await trpc(app, "clinical.supportNotes", "query", { grantId }, ADMIN_USER);
    expect(read.statusCode).toBe(200);
    const body = visitNotesOutputSchema.parse(result(read));
    expect(body.encounterId).toBe(encounterId);
    expect(body.notes.length).toBeGreaterThan(0);

    const useAudit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(
          eq(clinicalAccessLog.grantId, grantId),
          eq(clinicalAccessLog.action, "support_notes_read"),
        ),
      );
    expect(useAudit).toHaveLength(1);
    expect(useAudit[0]!.actorUserId).toBe(ADMIN_USER.user);
  });

  it("a different admin cannot use someone else's grant", async () => {
    const created = await grant(60_000);
    const { grantId } = result<{ grantId: string }>(created);

    const read = await trpc(
      app,
      "clinical.supportNotes",
      "query",
      { grantId },
      { roles: "admin", user: "another-admin" },
    );
    expect(read.statusCode).toBe(403);
    expect(appCode(read)).toBe("SUPPORT_GRANT_INVALID");
  });

  it("revocation closes the grant (audited) and revoke is idempotent", async () => {
    const created = await grant(60_000);
    const { grantId } = result<{ grantId: string }>(created);

    const revoked = await trpc(
      app,
      "clinical.revokeSupportAccess",
      "mutation",
      { grantId },
      ADMIN_USER,
    );
    expect(revoked.statusCode).toBe(200);
    expect(result<{ revoked: boolean }>(revoked).revoked).toBe(true);

    const revokedAudit = await tdb.db
      .select()
      .from(clinicalAccessLog)
      .where(
        and(eq(clinicalAccessLog.grantId, grantId), eq(clinicalAccessLog.action, "grant_revoked")),
      );
    expect(revokedAudit).toHaveLength(1);

    const read = await trpc(app, "clinical.supportNotes", "query", { grantId }, ADMIN_USER);
    expect(read.statusCode).toBe(403);
    expect(appCode(read)).toBe("SUPPORT_GRANT_INVALID");

    const again = await trpc(
      app,
      "clinical.revokeSupportAccess",
      "mutation",
      { grantId },
      ADMIN_USER,
    );
    expect(again.statusCode).toBe(200);
    expect(result<{ revoked: boolean }>(again).revoked).toBe(false);
  });

  it("time-controlled: access succeeds inside the window and fails after expiry — enforced by the DB", async () => {
    const created = await grant(1_500);
    expect(created.statusCode).toBe(200);
    const { grantId } = result<{ grantId: string }>(created);

    const inside = await trpc(app, "clinical.supportNotes", "query", { grantId }, ADMIN_USER);
    expect(inside.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1_700));

    const after = await trpc(app, "clinical.supportNotes", "query", { grantId }, ADMIN_USER);
    expect(after.statusCode).toBe(412);
    expect(appCode(after)).toBe("SUPPORT_GRANT_EXPIRED");

    // Independent of the application layer: the SECURITY DEFINER function
    // itself refuses, even for a caller that bypasses the API entirely.
    await expect(
      tdb.pool.query("select * from clinical_support_read_visit_notes($1, $2)", [
        grantId,
        ADMIN_USER.user,
      ]),
    ).rejects.toThrow(/SUPPORT_GRANT_EXPIRED/);
  }, 30_000);

  it("rejects invalid windows with typed validation errors", async () => {
    const past = await grant(-1_000);
    expect(past.statusCode).toBe(400);
    expect(appCode(past)).toBe("VALIDATION");

    const tooLong = await grant(80 * 60 * 60 * 1000);
    expect(tooLong.statusCode).toBe(400);
    expect(appCode(tooLong)).toBe("VALIDATION");
  });

  it("grant metadata rows are immutable except revocation (DB-enforced)", async () => {
    const created = await grant(60_000);
    const { grantId } = result<{ grantId: string }>(created);

    await expect(
      tdb.pool.query(
        "update support_access_grants set expires_at = now() + interval '30 days' where id = $1",
        [grantId],
      ),
    ).rejects.toThrow(/CLINICAL_GRANT_IMMUTABLE/);
    await expect(
      tdb.pool.query("update support_access_grants set reason = 'rewritten' where id = $1", [
        grantId,
      ]),
    ).rejects.toThrow(/CLINICAL_GRANT_IMMUTABLE/);
    await expect(
      tdb.pool.query("delete from support_access_grants where id = $1", [grantId]),
    ).rejects.toThrow(/CLINICAL_APPEND_ONLY/);
  });

  it("lists grants for an encounter (contract-valid)", async () => {
    const res = await trpc(app, "clinical.listSupportGrants", "query", { encounterId }, ADMIN_USER);
    expect(res.statusCode).toBe(200);
    const body = listSupportGrantsOutputSchema.parse(result(res));
    expect(body.grants.length).toBeGreaterThanOrEqual(5);
    expect(body.grants.every((g) => g.encounterId === encounterId)).toBe(true);
  });
});
