import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockEmailChannel, createMockOtpChannel } from "@mesomed/platform";
import { placeholderEmailForPhone } from "@mesomed/domain/identity";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { eq, providerProfiles, user, verification } from "@mesomed/db";
import { buildServer } from "../../src/app.js";
import { testEnv } from "../helpers.js";

/**
 * Password recovery (MM-DEC rev02 §5 as written — MM-QA-004 F-01):
 * patients recover by phone OTP (WhatsApp→SMS) or email; providers by
 * verified email first, phone OTP (profile phone) as the fallback; the
 * admin manual path stays (covered in provider-auth tests). Every reset
 * is single-use, short-lived, rate-limited by the OTP-abuse machinery,
 * and revokes all sessions.
 */
describe("password recovery (MM-DEC rev02 §5, F-01)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  const whatsapp = createMockOtpChannel("whatsapp");
  const sms = createMockOtpChannel("sms");
  const email = createMockEmailChannel();

  const PATIENT_PHONE = "+9647705000001";
  const PATIENT_PASSWORD = "patient first pw";
  const PROVIDER_EMAIL = "recovery-doctor@test.mesomed.example";
  const PROVIDER_PASSWORD = "provider first pw";
  const PROVIDER_PHONE = "+9647705000002";
  let providerUserId = "";

  function cookieFrom(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers["set-cookie"];
    const list = Array.isArray(raw) ? raw : [raw];
    return list
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.split(";")[0])
      .join("; ");
  }

  /** system.whoami is public — session liveness shows in the body, not the status. */
  async function whoamiUserId(cookie: string): Promise<string | null> {
    const res = await app.inject({
      method: "GET",
      url: "/trpc/system.whoami",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { result: { data: { userId: string | null } } }).result.data.userId;
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString), {
      otpChannels: { whatsapp, sms },
      emailChannel: email,
    });
    await app.ready();

    // Patient: real signup + OTP verification (proven flow, minimal seed).
    const patientSignup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        name: "Recovery Patient",
        email: placeholderEmailForPhone(PATIENT_PHONE),
        password: PATIENT_PASSWORD,
        phoneNumber: PATIENT_PHONE,
      },
    });
    expect(patientSignup.statusCode).toBe(200);
    await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: PATIENT_PHONE },
    });
    const signupCode = whatsapp.sent.at(-1)?.code;
    const verify = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/verify",
      payload: { phoneNumber: PATIENT_PHONE, code: signupCode },
    });
    expect(verify.statusCode).toBe(200);

    // Provider: email signup, email verified directly (verification flow
    // is proven in provider-auth tests), profile phone on the identity
    // provider profile — the §5 phone-leg key.
    const providerSignup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Recovery Doctor", email: PROVIDER_EMAIL, password: PROVIDER_PASSWORD },
    });
    expect(providerSignup.statusCode).toBe(200);
    providerUserId = (providerSignup.json() as { user: { id: string } }).user.id;
    const { db } = app.kernel;
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, providerUserId));
    await db.insert(providerProfiles).values({
      userId: providerUserId,
      providerType: "doctor",
      status: "approved",
      phone: PROVIDER_PHONE,
    });
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("patient resets by phone OTP: single-use code, sessions revoked, new password works", async () => {
    // A live session that must die on reset (§4).
    const preLogin = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/phone-number",
      payload: { phoneNumber: PATIENT_PHONE, password: PATIENT_PASSWORD },
    });
    expect(preLogin.statusCode).toBe(200);
    const preCookie = cookieFrom(preLogin);
    expect(await whoamiUserId(preCookie)).not.toBeNull();

    const request = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/request-password-reset",
      payload: { phoneNumber: PATIENT_PHONE },
    });
    expect(request.statusCode).toBe(200);
    const code = whatsapp.sent.at(-1)?.code;
    expect(code).toMatch(/^\d{6}$/);

    const reset = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/reset-password",
      payload: { otp: code, phoneNumber: PATIENT_PHONE, newPassword: "patient second pw" },
    });
    expect(reset.statusCode).toBe(200);

    // Sessions revoked; old password dead; new password signs in.
    expect(await whoamiUserId(preCookie)).toBeNull();
    const oldPw = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/phone-number",
      payload: { phoneNumber: PATIENT_PHONE, password: PATIENT_PASSWORD },
    });
    expect(oldPw.statusCode).toBeGreaterThanOrEqual(400);
    const newPw = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/phone-number",
      payload: { phoneNumber: PATIENT_PHONE, password: "patient second pw" },
    });
    expect(newPw.statusCode).toBe(200);

    // Single-use: the consumed OTP cannot reset again.
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/reset-password",
      payload: { otp: code, phoneNumber: PATIENT_PHONE, newPassword: "patient third pw" },
    });
    expect(replay.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("an expired reset OTP is rejected", async () => {
    const request = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/request-password-reset",
      payload: { phoneNumber: PATIENT_PHONE },
    });
    expect(request.statusCode).toBe(200);
    const code = whatsapp.sent.at(-1)?.code;

    // Force expiry in the verification store (no clock control over the
    // plugin's Date.now).
    const { db } = app.kernel;
    const identifier = `${PATIENT_PHONE}-request-password-reset`;
    const updated = await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, identifier))
      .returning({ id: verification.id });
    expect(updated.length).toBe(1);

    const reset = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/reset-password",
      payload: { otp: code, phoneNumber: PATIENT_PHONE, newPassword: "never applied pw" },
    });
    expect(reset.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("reset-OTP sends hit the per-phone send limit (OTP-abuse machinery)", async () => {
    // Fresh phone so the count is deterministic: signup verify used 1 of
    // the 5-per-hour budget, leaving exactly 4 reset sends.
    const phone = "+9647705000003";
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        name: "Rate Limited",
        email: placeholderEmailForPhone(phone),
        password: "rate limit pw",
        phoneNumber: phone,
      },
    });
    expect(signup.statusCode).toBe(200);
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
    expect(verify.statusCode).toBe(200);

    for (let i = 0; i < 4; i++) {
      const ok = await app.inject({
        method: "POST",
        url: "/api/auth/phone-number/request-password-reset",
        payload: { phoneNumber: phone },
      });
      expect(ok.statusCode).toBe(200);
    }
    // The endpoint deliberately answers 200 either way (no enumeration;
    // Better Auth awaits the send callback but swallows its errors) — the
    // enforced protection is that NOTHING is delivered once the per-phone
    // budget is spent.
    const sentBefore = whatsapp.sent.length + sms.sent.length;
    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/request-password-reset",
      payload: { phoneNumber: phone },
    });
    expect(limited.statusCode).toBe(200);
    expect(whatsapp.sent.length + sms.sent.length).toBe(sentBefore);
  });

  it("provider resets by verified email: single-use token, sessions revoked", async () => {
    const preLogin = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: PROVIDER_EMAIL, password: PROVIDER_PASSWORD },
    });
    expect(preLogin.statusCode).toBe(200);
    const preCookie = cookieFrom(preLogin);
    expect(await whoamiUserId(preCookie)).not.toBeNull();

    const request = await app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: PROVIDER_EMAIL, redirectTo: "/en/auth/reset-password" },
    });
    expect(request.statusCode).toBe(200);
    const mail = email.sent.at(-1);
    expect(mail?.to).toBe(PROVIDER_EMAIL);
    const token = /reset-password\/([A-Za-z0-9_-]+)\?/.exec(mail?.text ?? "")?.[1];
    expect(token).toBeTruthy();

    const reset = await app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: "provider second pw", token },
    });
    expect(reset.statusCode).toBe(200);

    expect(await whoamiUserId(preCookie)).toBeNull();
    const oldPw = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: PROVIDER_EMAIL, password: PROVIDER_PASSWORD },
    });
    expect(oldPw.statusCode).toBeGreaterThanOrEqual(400);
    const newPw = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: PROVIDER_EMAIL, password: "provider second pw" },
    });
    expect(newPw.statusCode).toBe(200);

    // Single-use token.
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: "provider third pw", token },
    });
    expect(replay.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("a patient placeholder email is never mailed (and the response does not enumerate)", async () => {
    const before = email.sent.length;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: {
        email: placeholderEmailForPhone(PATIENT_PHONE),
        redirectTo: "/en/auth/reset-password",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(email.sent.length).toBe(before);
  });

  it("provider recovers by profile phone: OTP over WhatsApp, sessions revoked (tRPC)", async () => {
    const preLogin = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: PROVIDER_EMAIL, password: "provider second pw" },
    });
    expect(preLogin.statusCode).toBe(200);
    const preCookie = cookieFrom(preLogin);

    const request = await app.inject({
      method: "POST",
      url: "/trpc/identity.requestProviderRecoveryOtp",
      headers: { "content-type": "application/json" },
      payload: { phone: PROVIDER_PHONE },
    });
    expect(request.statusCode).toBe(200);
    expect(request.json().result.data).toEqual({ sent: true });
    const code = whatsapp.sent.at(-1)?.code;
    expect(whatsapp.sent.at(-1)?.to).toBe(PROVIDER_PHONE);
    expect(code).toMatch(/^\d{6}$/);

    const reset = await app.inject({
      method: "POST",
      url: "/trpc/identity.resetProviderPasswordByOtp",
      headers: { "content-type": "application/json" },
      payload: { phone: PROVIDER_PHONE, code, newPassword: "provider fourth pw" },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().result.data).toEqual({ reset: true });

    expect(await whoamiUserId(preCookie)).toBeNull();
    const newPw = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: PROVIDER_EMAIL, password: "provider fourth pw" },
    });
    expect(newPw.statusCode).toBe(200);
  });

  it("provider recovery request does not enumerate phones (no send for a miss)", async () => {
    const sentBefore = whatsapp.sent.length + sms.sent.length;
    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.requestProviderRecoveryOtp",
      headers: { "content-type": "application/json" },
      payload: { phone: "+9647709999999" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.data).toEqual({ sent: true });
    expect(whatsapp.sent.length + sms.sent.length).toBe(sentBefore);
  });

  it("a wrong provider recovery code burns the OTP (single attempt)", async () => {
    const request = await app.inject({
      method: "POST",
      url: "/trpc/identity.requestProviderRecoveryOtp",
      headers: { "content-type": "application/json" },
      payload: { phone: PROVIDER_PHONE },
    });
    expect(request.statusCode).toBe(200);
    const realCode = whatsapp.sent.at(-1)?.code;

    const wrong = await app.inject({
      method: "POST",
      url: "/trpc/identity.resetProviderPasswordByOtp",
      headers: { "content-type": "application/json" },
      payload: { phone: PROVIDER_PHONE, code: "000000", newPassword: "attacker chosen pw" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.data.appCode).toBe("UNAUTHORIZED");

    // The real code is now consumed too — single attempt per code.
    const burned = await app.inject({
      method: "POST",
      url: "/trpc/identity.resetProviderPasswordByOtp",
      headers: { "content-type": "application/json" },
      payload: { phone: PROVIDER_PHONE, code: realCode, newPassword: "attacker chosen pw" },
    });
    expect(burned.statusCode).toBe(401);

    // And the provider's password is unchanged.
    const stillWorks = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: PROVIDER_EMAIL, password: "provider fourth pw" },
    });
    expect(stillWorks.statusCode).toBe(200);
  });
});
