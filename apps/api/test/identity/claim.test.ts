import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createEventRegistry } from "@mesomed/contracts/events";
import { ErrorCode } from "@mesomed/contracts/errors";
import { createMockEmailChannel, createMockOtpChannel } from "@mesomed/platform";
import { placeholderEmailForPhone } from "@mesomed/domain/identity";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { domainEvents, eq, patientProfiles, user, userRoles } from "@mesomed/db";
import { buildServer } from "../../src/app.js";
import { claimPatientProfile } from "../../src/modules/identity/commands/claim-patient-profile.js";
import { createGuestPatientProfile } from "../../src/modules/identity/commands/create-guest-patient-profile.js";
import { testEnv } from "../helpers.js";

const PASSWORD = "correct horse battery";

async function registerAndVerify(
  app: FastifyInstance,
  whatsapp: ReturnType<typeof createMockOtpChannel>,
  phone: string,
  name: string,
): Promise<number> {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: {
      name,
      email: placeholderEmailForPhone(phone),
      password: PASSWORD,
      phoneNumber: phone,
    },
  });
  await app.inject({
    method: "POST",
    url: "/api/auth/phone-number/send-otp",
    payload: { phoneNumber: phone },
  });
  const verify = await app.inject({
    method: "POST",
    url: "/api/auth/phone-number/verify",
    payload: { phoneNumber: phone, code: whatsapp.sent.at(-1)?.code },
  });
  return verify.statusCode;
}

describe("guest → account claim (MM-DEC rev02 §2, convention #7)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  const whatsapp = createMockOtpChannel("whatsapp");
  const sms = createMockOtpChannel("sms");
  const email = createMockEmailChannel();

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString), {
      otpChannels: { whatsapp, sms },
      emailChannel: email,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("upgrades an existing guest profile in place — same row, history preserved", async () => {
    const phone = "+9647704000001";
    const { db, outbox } = app.kernel;
    const guest = await db.transaction((tx) =>
      createGuestPatientProfile(tx, outbox, {
        fullName: "Guest With History",
        phone,
        dateOfBirth: "1990-05-01",
      }),
    );

    const status = await registerAndVerify(app, whatsapp, phone, "Registered Name");
    expect(status).toBe(200);

    const [profile] = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, phone));
    // Upgraded IN PLACE: same profile id, no duplicate, guest data kept.
    expect(profile?.id).toBe(guest.profileId);
    expect(profile?.fullName).toBe("Guest With History");
    expect(profile?.dateOfBirth).toBe("1990-05-01");
    expect(profile?.userId).toBeTruthy();
    expect(profile?.claimedAt).toBeInstanceOf(Date);

    const all = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, phone));
    expect(all).toHaveLength(1);

    const events = await db.select().from(domainEvents);
    const claimed = events.filter(
      (e) => e.name === "identity.profile_claimed.v1" && e.aggregateId === guest.profileId,
    );
    expect(claimed).toHaveLength(1);
    expect((claimed[0]?.payload as { proof: string }).proof).toBe("otp-verified-phone");
    // The guest-created profile must not get a second "created" event.
    const created = events.filter(
      (e) => e.name === "identity.patient_profile_created.v2" && e.aggregateId === guest.profileId,
    );
    expect(created).toHaveLength(1);
    expect((created[0]?.payload as { source: string }).source).toBe("guest_booking");
  });

  it("one user cannot claim a profile owned by another (command invariant)", async () => {
    const phone = "+9647704000001"; // claimed above
    const { db, outbox } = app.kernel;
    await db.insert(user).values({ id: "attacker-1", name: "Attacker", email: "a@example.com" });

    await expect(
      db.transaction((tx) =>
        claimPatientProfile(tx, outbox, {
          userId: "attacker-1",
          normalizedPhone: phone,
          proof: "otp-verified-phone",
          proofVerified: true,
          fullNameFallback: "Attacker",
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PROFILE_ALREADY_CLAIMED });

    const [profile] = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, phone));
    expect(profile?.userId).not.toBe("attacker-1");
  });

  it("meta-test: no unverified claim path exists — unverified proof is rejected for every profile state", async () => {
    const { db, outbox } = app.kernel;
    await db.insert(user).values({ id: "unverified-1", name: "U", email: "u@example.com" });

    // Existing unclaimed guest profile.
    await db.transaction((tx) =>
      createGuestPatientProfile(tx, outbox, { fullName: "Unclaimed", phone: "+9647704000002" }),
    );

    for (const phone of ["+9647704000002" /* guest exists */, "+9647704000003" /* none */]) {
      await expect(
        db.transaction((tx) =>
          claimPatientProfile(tx, outbox, {
            userId: "unverified-1",
            normalizedPhone: phone,
            proof: "otp-verified-phone",
            proofVerified: false,
            fullNameFallback: "U",
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.PHONE_NOT_VERIFIED });
    }

    // Nothing was claimed or created.
    const [guest] = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, "+9647704000002"));
    expect(guest?.userId).toBeNull();
    const none = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, "+9647704000003"));
    expect(none).toHaveLength(0);
  });

  it("claims via the verified-email path: guest email matches the account's verified email", async () => {
    const phone = "+9647704000010";
    const address = "email-path@example.com";
    const { db, outbox } = app.kernel;
    const guest = await db.transaction((tx) =>
      createGuestPatientProfile(tx, outbox, {
        fullName: "Email Path Guest",
        phone,
        email: address,
      }),
    );

    // Register an email+password account with that address and verify it.
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Email Patient", email: address, password: PASSWORD },
    });
    const mailText = email.sent.at(-1)?.text ?? "";
    const link = new URL(mailText.match(/https?:\/\/\S+/)![0]);
    await app.inject({ method: "GET", url: link.pathname + link.search });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: address, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const cookieHeader = (
      Array.isArray(login.headers["set-cookie"])
        ? login.headers["set-cookie"]
        : [login.headers["set-cookie"]]
    )
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.split(";")[0])
      .join("; ");

    const claim = await app.inject({
      method: "POST",
      url: "/trpc/identity.claimProfile",
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      payload: { phone: "0770 400 0010" },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().result.data).toMatchObject({
      profileId: guest.profileId,
      proof: "verified-email",
    });

    const [profile] = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.id, guest.profileId));
    expect(profile?.userId).toBeTruthy();

    // Patient role + registration events for the email-path patient.
    const roleRows = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, profile!.userId!));
    expect(roleRows.map((r) => r.role)).toContain("patient");
  });

  it("rejects the email path when the guest profile has a different email", async () => {
    const phone = "+9647704000011";
    const { db, outbox } = app.kernel;
    await db.transaction((tx) =>
      createGuestPatientProfile(tx, outbox, {
        fullName: "Mismatch Guest",
        phone,
        email: "someone-else@example.com",
      }),
    );

    const address = "mismatch@example.com";
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Mismatch Patient", email: address, password: PASSWORD },
    });
    const mailText = email.sent.at(-1)?.text ?? "";
    const link = new URL(mailText.match(/https?:\/\/\S+/)![0]);
    await app.inject({ method: "GET", url: link.pathname + link.search });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: address, password: PASSWORD },
    });
    const cookieHeader = (
      Array.isArray(login.headers["set-cookie"])
        ? login.headers["set-cookie"]
        : [login.headers["set-cookie"]]
    )
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.split(";")[0])
      .join("; ");

    const claim = await app.inject({
      method: "POST",
      url: "/trpc/identity.claimProfile",
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      payload: { phone },
    });
    expect(claim.statusCode).toBe(412);
    expect(claim.json().error.data.appCode).toBe("PHONE_NOT_VERIFIED");

    const [profile] = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, phone));
    expect(profile?.userId).toBeNull();
  });
});

describe("claim atomicity — state and events commit or roll back together", () => {
  // Provisioning (embedded-PG initdb + start + migrations) is hoisted into
  // beforeAll/afterAll rather than run inside the test body. Every other
  // integration test in the suite provisions in a hook for the same reason:
  // hooks run under vitest's 120s hookTimeout, whereas a test body is bound
  // by the 30s testTimeout. Under full-suite CPU/disk contention, initdb
  // (fork- and fsync-heavy) is the one step in this file that can plausibly
  // approach 30s — the password/query steps are all sub-second — so leaving
  // it in the body made this the file's lone timeout-flake risk. Moving it
  // to setup removes that risk at the root instead of widening a number.
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    // Registry with NO identity events: outbox.emit throws inside the
    // verification transaction, after the role insert and profile claim.
    app = await buildServer(testEnv(tdb.connectionString), {
      eventRegistry: createEventRegistry([]),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("a failed event write aborts the whole verification transaction", async () => {
    const phone = "+9647704000009";
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        name: "Rollback Case",
        email: placeholderEmailForPhone(phone),
        password: PASSWORD,
        phoneNumber: phone,
      },
    });
    // Read the OTP from Better Auth's verification store directly (the
    // default mock channels are internal to the app instance).
    await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: phone },
    });
    const { rows } = await tdb.pool.query<{ value: string }>(
      `select value from verification where identifier = $1 order by created_at desc limit 1`,
      [phone],
    );
    const code = rows[0]?.value.split(":")[0];
    expect(code).toMatch(/^\d{6}$/);

    const verify = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/verify",
      payload: { phoneNumber: phone, code },
    });
    // The hook failed -> the endpoint fails.
    expect(verify.statusCode).toBeGreaterThanOrEqual(400);

    // NOTHING from the identity transaction survived: no role, no claim,
    // no events — state and events are atomic (§3.2).
    const { rows: roleRows } = await tdb.pool.query(
      `select ur.* from user_roles ur join "user" u on u.id = ur.user_id
       where u.phone_number = $1`,
      [phone],
    );
    expect(roleRows).toHaveLength(0);
    const profiles = await app.kernel.db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, phone));
    expect(profiles).toHaveLength(0);
    const events = await app.kernel.db.select().from(domainEvents);
    expect(events).toHaveLength(0);
    // Sanity: the flow above does exercise the role-insert path normally.
    const roles = await app.kernel.db.select().from(userRoles);
    expect(roles).toHaveLength(0);
  });
});
