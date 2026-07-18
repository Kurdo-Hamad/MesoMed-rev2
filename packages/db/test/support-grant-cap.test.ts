import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";
import { sql } from "../src/index.js";

/**
 * MM-QA-004 F-20 (ADR-0048): the 72h support-grant window cap is enforced
 * INSIDE the SECURITY DEFINER function since migration 0014 — a direct DB
 * caller can no longer mint an unbounded grant even if the app-layer
 * check (packages/domain support-grant-policy) is bypassed.
 */
describe("clinical_grant_support_access window cap (DB backstop)", () => {
  let tdb: TestDatabase;
  let encounterId = "";

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const profile = await tdb.db.execute(sql`
      insert into patient_profiles (normalized_phone, full_name)
      values ('+9647705550001', 'Grant Cap Patient')
      returning id
    `);
    const profileId = profile.rows[0]!["id"] as string;
    const appt = await tdb.db.execute(sql`
      insert into appointments (doctor_location_id, patient_profile_id, starts_at, ends_at, booked_via)
      values ('00000000-0000-0000-0000-0000000000b1', ${profileId}::uuid, now(), now() + interval '30 minutes', 'guest_web')
      returning id
    `);
    const enc = await tdb.db.execute(sql`
      insert into encounters (appointment_id, doctor_profile_id, patient_profile_id, starts_at, ends_at)
      values (${appt.rows[0]!["id"]}, '00000000-0000-0000-0000-0000000000d1',
              ${profileId}::uuid, now(), now() + interval '30 minutes')
      returning id
    `);
    encounterId = enc.rows[0]!["id"] as string;
  });

  afterAll(async () => {
    await tdb.close();
  });

  /** Drizzle wraps pg errors; the RAISE message lives on the cause. */
  async function causeMessage(query: Promise<unknown>): Promise<string> {
    const failure = await query.then(() => null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const cause = (failure as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    return (cause as Error).message;
  }

  it("accepts a grant inside the 72h window", async () => {
    const result = await tdb.db.execute(sql`
      select clinical_grant_support_access(${encounterId}::uuid, 'admin-x', 'admin-x', 'support case', now() + interval '48 hours') as id
    `);
    expect(result.rows[0]!["id"]).toBeTruthy();
  });

  it("rejects a grant beyond 72h with SUPPORT_GRANT_WINDOW_TOO_LONG", async () => {
    const message = await causeMessage(
      tdb.db.execute(sql`
        select clinical_grant_support_access(${encounterId}::uuid, 'admin-x', 'admin-x', 'support case', now() + interval '80 hours')
      `),
    );
    expect(message).toMatch(/SUPPORT_GRANT_WINDOW_TOO_LONG/);
  });

  it("still rejects a non-future expiry with SUPPORT_GRANT_INVALID", async () => {
    const message = await causeMessage(
      tdb.db.execute(sql`
        select clinical_grant_support_access(${encounterId}::uuid, 'admin-x', 'admin-x', 'support case', now() - interval '1 minute')
      `),
    );
    expect(message).toMatch(/SUPPORT_GRANT_INVALID/);
  });
});
