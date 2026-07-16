import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { verifyDbRole } from "../scripts/verify-db-role.js";

/**
 * Phase 10 Slice 5 (ADR-0027): the least-privilege verification script is
 * itself CI-verified — every check passes for the real `mesomed_api` role
 * on a migrated database, and the negative control proves the script
 * actually discriminates (the owner/superuser connection FAILS it).
 */
describe("verify:db-role (ADR-0027)", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await tdb.close();
  });

  it("all checks pass for mesomed_api", async () => {
    const results = await verifyDbRole(tdb.connectionString, { setRole: "mesomed_api" });
    const failed = results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
    // The full posture, pinned: any new check must be seen here.
    expect(results.map((r) => r.name)).toEqual([
      "role has no superuser/createdb/createrole/bypassrls",
      "role owns no tables",
      "DDL (create table) denied",
      "clinical_access_log INSERT denied",
      "clinical_access_log UPDATE denied",
      "clinical_access_log DELETE denied",
      "direct SELECT on encounters denied",
      "direct SELECT on visit_notes denied",
      "direct SELECT on prescriptions denied",
      "RLS enabled on exactly encounters/prescriptions/visit_notes",
      "zero RLS policies (deny-all)",
      "SECURITY DEFINER channel executable",
    ]);
  });

  it("negative control: the owner/superuser connection fails the check", async () => {
    const results = await verifyDbRole(tdb.connectionString);
    const failed = results.filter((r) => !r.ok);
    // Superuser trivially violates the privilege checks — if this ever
    // passes, the script has stopped discriminating and is lying.
    expect(failed.length).toBeGreaterThan(0);
  });
});
