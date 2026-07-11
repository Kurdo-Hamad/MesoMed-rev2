import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockEmailChannel, createMockOtpChannel } from "@mesomed/platform";
import { placeholderEmailForPhone } from "@mesomed/domain/identity";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { domainEvents, eq, patientProfiles, userRoles } from "@mesomed/db";
import { buildServer } from "../../src/app.js";
import { testEnv } from "../helpers.js";

const PHONE = "+9647701000001";
const PASSWORD = "correct horse battery";

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.split(";")[0])
    .join("; ");
}

describe("patient auth (phone + password + OTP)", () => {
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

  it("registers: signup with phone+password, OTP over WhatsApp, verify creates a session", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        name: "Test Patient",
        email: placeholderEmailForPhone(PHONE),
        password: PASSWORD,
        phoneNumber: PHONE,
      },
    });
    expect(signup.statusCode).toBe(200);

    const sendOtp = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: PHONE },
    });
    expect(sendOtp.statusCode).toBe(200);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]?.to).toBe(PHONE);
    expect(whatsapp.sent[0]?.code).toMatch(/^\d{6}$/);
    expect(sms.sent).toHaveLength(0);

    const verify = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/verify",
      payload: { phoneNumber: PHONE, code: whatsapp.sent[0]?.code },
    });
    expect(verify.statusCode).toBe(200);
    const cookie = cookieFrom(verify);
    expect(cookie).toContain("session_token");

    // Role assigned synchronously in the verification transaction.
    const kernel = app.kernel;
    const roles = await kernel.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.role, "patient"));
    expect(roles.length).toBeGreaterThan(0);

    // A claimed patient profile exists for the phone.
    const [profile] = await kernel.db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.normalizedPhone, PHONE));
    expect(profile?.userId).toBeTruthy();
    expect(profile?.claimedAt).toBeInstanceOf(Date);

    // Events written through the outbox, atomically with the state.
    const events = await kernel.db.select().from(domainEvents);
    const names = events.map((event) => event.name);
    expect(names).toContain("identity.user_registered.v1");
    expect(names).toContain("identity.role_assigned.v1");
    expect(names).toContain("identity.patient_profile_created.v1");
    expect(names).toContain("identity.profile_claimed.v1");

    // The session works against the kernel context (whoami).
    const whoami = await app.inject({
      method: "GET",
      url: "/trpc/system.whoami",
      headers: { cookie },
    });
    expect(whoami.statusCode).toBe(200);
    const body = whoami.json();
    expect(body.result.data.roles).toEqual(["patient"]);
    expect(body.result.data.userId).toBeTruthy();

    // The placeholder email must never be mailed.
    expect(email.sent).toHaveLength(0);
  });

  it("logs in with phone + password and no OTP is sent (MM-DEC §4)", async () => {
    const sentBefore = whatsapp.sent.length + sms.sent.length;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/phone-number",
      payload: { phoneNumber: PHONE, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(cookieFrom(login)).toContain("session_token");
    expect(whatsapp.sent.length + sms.sent.length).toBe(sentBefore);
  });

  it("rejects a wrong password", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/phone-number",
      payload: { phoneNumber: PHONE, password: "wrong password entirely" },
    });
    expect(login.statusCode).toBe(401);
  });

  it("blocks phone sign-in until the phone is verified (no unverified login path)", async () => {
    const phone = "+9647701000002";
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        name: "Unverified Patient",
        email: placeholderEmailForPhone(phone),
        password: PASSWORD,
        phoneNumber: phone,
      },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/phone-number",
      payload: { phoneNumber: phone, password: PASSWORD },
    });
    expect(login.statusCode).toBe(401);
  });

  it("blocks email+password sign-in via the placeholder email (never verified)", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: placeholderEmailForPhone(PHONE), password: PASSWORD },
    });
    expect(login.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("rejects non-normalized phone numbers at the auth boundary", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        name: "Bad Phone",
        email: placeholderEmailForPhone("+9647701000003"),
        password: PASSWORD,
        phoneNumber: "0770 100 0003",
      },
    });
    expect(signup.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("persists the session across requests and kills it on sign-out", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/phone-number",
      payload: { phoneNumber: PHONE, password: PASSWORD },
    });
    const cookie = cookieFrom(login);

    const before = await app.inject({
      method: "GET",
      url: "/trpc/system.whoami",
      headers: { cookie },
    });
    expect(before.json().result.data.userId).toBeTruthy();

    const signOut = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie },
      payload: {},
    });
    expect(signOut.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/trpc/system.whoami",
      headers: { cookie },
    });
    expect(after.json().result.data.userId).toBeNull();
  });

  it("re-verifying an already-verified phone stays idempotent (no duplicate events)", async () => {
    const send = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: PHONE },
    });
    expect(send.statusCode).toBe(200);
    const code = whatsapp.sent.at(-1)?.code;
    const verify = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/verify",
      payload: { phoneNumber: PHONE, code },
    });
    expect(verify.statusCode).toBe(200);

    const events = await app.kernel.db.select().from(domainEvents);
    const registered = events.filter((event) => event.name === "identity.user_registered.v1");
    // Two users signed up in this suite, but re-verification must not
    // produce another user_registered/profile_claimed pair.
    expect(registered).toHaveLength(1);
    const claimed = events.filter((event) => event.name === "identity.profile_claimed.v1");
    expect(claimed).toHaveLength(1);
  });
});
