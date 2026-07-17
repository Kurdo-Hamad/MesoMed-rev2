import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ErrorCode } from "@mesomed/contracts/errors";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { domainEvents, eq, patientProfiles } from "@mesomed/db";
import { buildServer } from "../../src/app.js";
import { createGuestPatientProfile } from "../../src/modules/identity/commands/create-guest-patient-profile.js";
import { AppError } from "../../src/kernel/errors.js";
import { testEnv } from "../helpers.js";

describe("guest patient profiles (create-on-booking, MM-DEC rev02 §1)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("creates an unverified phone-keyed profile and emits patient_profile_created", async () => {
    const { db, outbox } = app.kernel;
    const result = await db.transaction((tx) =>
      createGuestPatientProfile(tx, outbox, {
        fullName: "Guest Zero",
        phone: "0770 300 0001",
        email: "guest@example.com",
      }),
    );
    expect(result.created).toBe(true);

    const [profile] = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.id, result.profileId));
    expect(profile?.normalizedPhone).toBe("+9647703000001");
    expect(profile?.userId).toBeNull();
    expect(profile?.claimedAt).toBeNull();
    expect(profile?.fullName).toBe("Guest Zero");

    const events = await db.select().from(domainEvents);
    const created = events.filter((e) => e.name === "identity.patient_profile_created.v2");
    expect(created).toHaveLength(1);
    expect((created[0]?.payload as { source: string }).source).toBe("guest_booking");
  });

  it("is idempotent across phone spellings — one profile, one event", async () => {
    const { db, outbox } = app.kernel;
    const again = await db.transaction((tx) =>
      createGuestPatientProfile(tx, outbox, {
        fullName: "Guest Zero Duplicate",
        phone: "+964 770 300-0001",
      }),
    );
    expect(again.created).toBe(false);

    const rows = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, "+9647703000001"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fullName).toBe("Guest Zero");

    const events = await db.select().from(domainEvents);
    expect(events.filter((e) => e.name === "identity.patient_profile_created.v2")).toHaveLength(1);
  });

  it("rejects an invalid phone with a typed VALIDATION error", async () => {
    const { db, outbox } = app.kernel;
    await expect(
      db.transaction((tx) =>
        createGuestPatientProfile(tx, outbox, { fullName: "Bad", phone: "not-a-phone" }),
      ),
    ).rejects.toThrow(AppError);
    await expect(
      db.transaction((tx) =>
        createGuestPatientProfile(tx, outbox, { fullName: "Bad", phone: "not-a-phone" }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION });
  });
});
