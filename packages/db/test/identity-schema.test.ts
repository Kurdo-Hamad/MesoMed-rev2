import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { patientProfiles, providerProfiles, user, userRoles } from "../src/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

describe("identity schema (Phase 2)", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  });

  afterAll(async () => {
    await tdb.close();
  });

  it("creates the Better Auth and identity module tables", async () => {
    const { rows } = await tdb.pool.query<{ name: string | null }>(
      `select to_regclass('public."user"')::text as name
       union all select to_regclass('public.session')::text
       union all select to_regclass('public.account')::text
       union all select to_regclass('public.verification')::text
       union all select to_regclass('public.user_roles')::text
       union all select to_regclass('public.patient_profiles')::text
       union all select to_regclass('public.provider_profiles')::text
       union all select to_regclass('public.otp_send_attempts')::text`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      '"user"', // reserved identifier — to_regclass returns it quoted
      "session",
      "account",
      "verification",
      "user_roles",
      "patient_profiles",
      "provider_profiles",
      "otp_send_attempts",
    ]);
  });

  it("enforces one profile per normalized phone at the database level", async () => {
    await tdb.db.insert(patientProfiles).values({
      normalizedPhone: "+9647700000001",
      fullName: "Guest One",
    });
    await expect(
      tdb.pool.query(
        `insert into patient_profiles (normalized_phone, full_name)
         values ('+9647700000001', 'Guest One Again')`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("enforces at most one claimed profile per user", async () => {
    await tdb.db.insert(user).values([{ id: "ident-u1", name: "U1", email: "u1@example.com" }]);
    await tdb.db.insert(patientProfiles).values({
      normalizedPhone: "+9647700000002",
      fullName: "Claimed",
      userId: "ident-u1",
    });
    await expect(
      tdb.pool.query(
        `insert into patient_profiles (normalized_phone, full_name, user_id)
         values ('+9647700000003', 'Second claim', 'ident-u1')`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("rejects duplicate role assignments but allows multiple roles per user", async () => {
    await tdb.db.insert(user).values([{ id: "ident-u2", name: "U2", email: "u2@example.com" }]);
    await tdb.db.insert(userRoles).values({ userId: "ident-u2", role: "patient" });
    await tdb.db.insert(userRoles).values({ userId: "ident-u2", role: "admin" });
    await expect(
      tdb.pool.query(`insert into user_roles (user_id, role) values ('ident-u2', 'patient')`),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("rejects an out-of-vocabulary role and provider status at the database level", async () => {
    await tdb.db.insert(user).values([{ id: "ident-u3", name: "U3", email: "u3@example.com" }]);
    await expect(
      tdb.pool.query(`insert into user_roles (user_id, role) values ('ident-u3', 'superuser')`),
    ).rejects.toThrow(/check|invalid input value/i);
    await expect(
      tdb.pool.query(
        `insert into provider_profiles (user_id, provider_type, status, phone)
         values ('ident-u3', 'doctor', 'live', '+9647700000009')`,
      ),
    ).rejects.toThrow(/check|invalid input value/i);
  });

  it("defaults provider status to pending", async () => {
    await tdb.db.insert(user).values([{ id: "ident-u4", name: "U4", email: "u4@example.com" }]);
    const [row] = await tdb.db
      .insert(providerProfiles)
      .values({ userId: "ident-u4", providerType: "doctor", phone: "+9647700000010" })
      .returning();
    expect(row?.status).toBe("pending");
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("cascades user deletion into roles", async () => {
    await tdb.db.insert(user).values([{ id: "ident-u5", name: "U5", email: "u5@example.com" }]);
    await tdb.db.insert(userRoles).values({ userId: "ident-u5", role: "doctor" });
    await tdb.pool.query(`delete from "user" where id = 'ident-u5'`);
    const { rows } = await tdb.pool.query(
      `select count(*)::int as count from user_roles where user_id = 'ident-u5'`,
    );
    expect(rows[0]?.count).toBe(0);
  });
});
