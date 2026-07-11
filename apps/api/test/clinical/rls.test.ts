import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  buildBookingTestServer,
  seedClinic,
  trpc,
  type ClinicFixture,
} from "../booking/helpers.js";
import { completeAppointment, doctorSession } from "./helpers.js";

/**
 * Phase 5 gate — RLS independently verified: a RAW database connection
 * adopting the least-privilege API role (`mesomed_api`), bypassing the API
 * entirely, must be unable to select encounters/visit_notes and must reach
 * content exclusively through the SECURITY DEFINER channel. Also asserts
 * the audit log is append-only at the DB level for every role.
 */
describe("clinical-tier RLS and DB-level guardrails (raw connection, no API)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let clinic: ClinicFixture;
  let encounterId: string;
  let raw: pg.Client;

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
      { encounterId, content: "rls fixture note" },
      doctorSession(clinic),
    );
    if (res.statusCode !== 200) throw new Error(`fixture note failed: ${res.body}`);

    raw = new pg.Client({ connectionString: tdb.connectionString });
    await raw.connect();
  }, 90_000);

  afterAll(async () => {
    await raw.end();
    await app.close();
    await tdb.close();
  });

  /** Run one statement as mesomed_api on the raw connection. */
  async function asApiRole<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<pg.QueryResult<T>> {
    await raw.query("set role mesomed_api");
    try {
      return await raw.query<T>(text, values as string[]);
    } finally {
      await raw.query("reset role");
    }
  }

  it("RLS is enabled with zero policies on encounters and visit_notes — and nowhere else", async () => {
    const rls = await raw.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity`,
    );
    expect(rls.rows.map((r) => r.relname).sort()).toEqual(["encounters", "visit_notes"]);

    const policies = await raw.query(`select polname from pg_policy`);
    expect(policies.rows).toHaveLength(0);
  });

  it("direct SELECT on encounters / visit_notes as mesomed_api is denied", async () => {
    await expect(asApiRole("select * from encounters")).rejects.toThrow(/permission denied/);
    await expect(asApiRole("select * from visit_notes")).rejects.toThrow(/permission denied/);
    await expect(
      asApiRole("select content from visit_notes where encounter_id = $1", [encounterId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("direct writes on the clinical tier as mesomed_api are denied", async () => {
    await expect(
      asApiRole(
        "insert into encounters (appointment_id, doctor_profile_id, patient_profile_id, starts_at, ends_at) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now(), now() + interval '30 min')",
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asApiRole("update visit_notes set content = 'x'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(asApiRole("delete from visit_notes")).rejects.toThrow(/permission denied/);
  });

  it("RLS backstop: even WITH a select grant, zero policies yield zero rows", async () => {
    // Simulate the failure mode RLS defends against: someone accidentally
    // grants SELECT to the API role. The deny-all (no-policy) RLS still
    // returns nothing, while the owner sees the rows.
    const owner = await raw.query("select count(*)::int as n from encounters");
    expect((owner.rows[0] as { n: number }).n).toBeGreaterThan(0);

    await raw.query("grant select on encounters, visit_notes to mesomed_api");
    try {
      const enc = await asApiRole<{ n: number }>("select count(*)::int as n from encounters");
      expect(enc.rows[0]!.n).toBe(0);
      const notes = await asApiRole<{ n: number }>("select count(*)::int as n from visit_notes");
      expect(notes.rows[0]!.n).toBe(0);
    } finally {
      await raw.query("revoke select on encounters, visit_notes from mesomed_api");
    }
  });

  it("the SECURITY DEFINER channel is the working path for mesomed_api — and is audited", async () => {
    const viaFunction = await asApiRole(
      "select * from clinical_read_encounters($1, $2, null, null)",
      ["rls-test-actor", encounterId],
    );
    expect(viaFunction.rows).toHaveLength(1);

    const notes = await asApiRole("select * from clinical_read_visit_notes($1, $2)", [
      "rls-test-actor",
      encounterId,
    ]);
    expect(notes.rows.length).toBeGreaterThan(0);

    const audit = await raw.query(
      `select action from clinical_access_log where actor_user_id = 'rls-test-actor' order by id`,
    );
    expect(audit.rows.map((r) => (r as { action: string }).action)).toEqual([
      "encounter_read",
      "notes_read",
    ]);
  });

  it("the channel functions are not executable by arbitrary roles (PUBLIC revoked)", async () => {
    await raw.query(`
      do $$ begin
        if not exists (select from pg_roles where rolname = 'mm_scratch_role') then
          create role mm_scratch_role nologin;
        end if;
      end $$`);
    try {
      const priv = await raw.query<{ api: boolean; scratch: boolean }>(
        `select
           has_function_privilege('mesomed_api', 'clinical_read_visit_notes(text, uuid)', 'execute') as api,
           has_function_privilege('mm_scratch_role', 'clinical_read_visit_notes(text, uuid)', 'execute') as scratch`,
      );
      expect(priv.rows[0]!.api).toBe(true);
      expect(priv.rows[0]!.scratch).toBe(false);
    } finally {
      await raw.query("drop role mm_scratch_role");
    }
  });

  it("clinical_access_log: UPDATE/DELETE denied at the DB level for the API role AND the owner", async () => {
    // API role: no privilege at all.
    await expect(asApiRole("update clinical_access_log set actor_user_id = 'x'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(asApiRole("delete from clinical_access_log")).rejects.toThrow(/permission denied/);
    await expect(
      asApiRole(
        "insert into clinical_access_log (actor_user_id, action) values ('forged', 'notes_read')",
      ),
    ).rejects.toThrow(/permission denied/);

    // Owner/superuser: privileges cannot help — the append-only trigger fires.
    await expect(raw.query("update clinical_access_log set actor_user_id = 'x'")).rejects.toThrow(
      /CLINICAL_APPEND_ONLY/,
    );
    await expect(raw.query("delete from clinical_access_log")).rejects.toThrow(
      /CLINICAL_APPEND_ONLY/,
    );
  });

  it("mesomed_api can read grant METADATA but cannot mutate it directly", async () => {
    const rows = await asApiRole("select id from support_access_grants");
    expect(Array.isArray(rows.rows)).toBe(true);
    await expect(asApiRole("update support_access_grants set revoked_at = now()")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asApiRole(
        "insert into support_access_grants (encounter_id, admin_user_id, granted_by, reason, expires_at) values ($1, 'a', 'a', 'direct insert', now() + interval '1 hour')",
        [encounterId],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
