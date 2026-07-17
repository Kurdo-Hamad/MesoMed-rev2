import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainEvents, eq } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";

/**
 * MM-QA-004 F-04 (closes MM-QA-002 F-07): migration 0010 redacts
 * phone/email/normalizedPhone from stored identity v1 payloads. The
 * migrated test database starts empty, so this suite inserts
 * legacy-shaped rows the way pre-0010 emitters wrote them, executes the
 * shipped migration SQL verbatim, and proves redaction, preservation of
 * everything else, and idempotency (a second run matches zero rows).
 */
const MIGRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/db/migrations/0010_redact_identity_event_pii.sql",
);

describe("migration 0010 — identity v1 event PII redaction", () => {
  let tdb: TestDatabase;
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  beforeAll(async () => {
    tdb = await createTestDatabase();
  });

  afterAll(async () => {
    await tdb.close();
  });

  it("redacts the PII keys, preserves everything else, and is idempotent", async () => {
    const [registered] = await tdb.db
      .insert(domainEvents)
      .values({
        name: "identity.user_registered.v1",
        version: 1,
        aggregateType: "user",
        aggregateId: "u1",
        payload: { userId: "u1", userType: "patient", phone: "+9647701234567", email: "a@b.co" },
        status: "processed",
      })
      .returning({ id: domainEvents.id, occurredAt: domainEvents.occurredAt });
    const [profileCreated] = await tdb.db
      .insert(domainEvents)
      .values({
        name: "identity.patient_profile_created.v1",
        version: 1,
        aggregateType: "patient_profile",
        aggregateId: "p1",
        payload: { profileId: "p1", normalizedPhone: "+9647701234567", source: "guest_booking" },
        status: "processed",
      })
      .returning({ id: domainEvents.id });
    // Control: a non-identity snapshot payload must pass through untouched,
    // even though it shares key names with nothing redacted ("phone" absent).
    const controlPayload = { appointmentId: "a1", startsAt: "2026-07-17T09:00:00Z" };
    const [control] = await tdb.db
      .insert(domainEvents)
      .values({
        name: "booking.booked.v1",
        version: 1,
        aggregateType: "appointment",
        aggregateId: "a1",
        payload: controlPayload,
        status: "processed",
      })
      .returning({ id: domainEvents.id });
    if (!registered || !profileCreated || !control) throw new Error("insert returned no row");

    const first = await tdb.pool.query(sql);
    expect(first.rowCount).toBe(2);

    const [redactedRegistered] = await tdb.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, registered.id));
    expect(redactedRegistered?.payload).toEqual({ userId: "u1", userType: "patient" });
    expect(redactedRegistered?.name).toBe("identity.user_registered.v1");
    expect(redactedRegistered?.version).toBe(1);
    expect(redactedRegistered?.aggregateId).toBe("u1");
    expect(redactedRegistered?.status).toBe("processed");
    expect(redactedRegistered?.occurredAt).toEqual(registered.occurredAt);

    const [redactedProfile] = await tdb.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, profileCreated.id));
    expect(redactedProfile?.payload).toEqual({ profileId: "p1", source: "guest_booking" });

    const [untouched] = await tdb.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, control.id));
    expect(untouched?.payload).toEqual(controlPayload);

    // Idempotency: nothing left to redact, so a re-run matches zero rows.
    const second = await tdb.pool.query(sql);
    expect(second.rowCount).toBe(0);
  });

  it("leaves already-redacted (v2-era) identity rows alone", async () => {
    const [row] = await tdb.db
      .insert(domainEvents)
      .values({
        name: "identity.user_registered.v1",
        version: 1,
        aggregateType: "user",
        aggregateId: "u2",
        payload: { userId: "u2", userType: "provider" },
        status: "processed",
      })
      .returning({ id: domainEvents.id });
    if (!row) throw new Error("insert returned no row");

    const run = await tdb.pool.query(sql);
    expect(run.rowCount).toBe(0);

    const [after] = await tdb.db.select().from(domainEvents).where(eq(domainEvents.id, row.id));
    expect(after?.payload).toEqual({ userId: "u2", userType: "provider" });
  });
});
