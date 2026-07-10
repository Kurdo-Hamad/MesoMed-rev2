import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockEmailChannel, createMockOtpChannel } from "@mesomed/platform";
import { placeholderEmailForPhone } from "@mesomed/domain/identity";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { domainEvents, eq, providerProfiles, user, userRoles } from "@mesomed/db";
import { buildServer } from "../../src/app.js";
import {
  isProviderPubliclyVisible,
  listApprovedProviders,
} from "../../src/modules/identity/queries/provider-visibility.js";
import { testEnv } from "../helpers.js";

const PASSWORD = "correct horse battery";

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.split(";")[0])
    .join("; ");
}

describe("provider accounts (email+password, verified email, pending gate)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  const whatsapp = createMockOtpChannel("whatsapp");
  const sms = createMockOtpChannel("sms");
  const email = createMockEmailChannel();

  let providerCookie = "";
  let providerUserId = "";
  let providerProfileId = "";
  let adminCookie = "";

  async function verifyEmailFromLastMail(): Promise<void> {
    const text = email.sent.at(-1)?.text ?? "";
    const match = text.match(/https?:\/\/\S+/);
    expect(match).toBeTruthy();
    const url = new URL(match![0]);
    const res = await app.inject({ method: "GET", url: url.pathname + url.search });
    expect([200, 302]).toContain(res.statusCode);
  }

  async function registerVerifiedUser(address: string, name: string): Promise<string> {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name, email: address, password: PASSWORD },
    });
    expect(signup.statusCode).toBe(200);
    expect(email.sent.at(-1)?.to).toBe(address);
    await verifyEmailFromLastMail();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: address, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    return cookieFrom(login);
  }

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

  it("signs up, is blocked from login until the email is verified, then logs in", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Dr. Provider", email: "doctor@example.com", password: PASSWORD },
    });
    expect(signup.statusCode).toBe(200);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe("doctor@example.com");

    const blocked = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "doctor@example.com", password: PASSWORD },
    });
    expect(blocked.statusCode).toBeGreaterThanOrEqual(400);

    await verifyEmailFromLastMail();

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "doctor@example.com", password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    providerCookie = cookieFrom(login);
    const [row] = await app.kernel.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "doctor@example.com"));
    providerUserId = row!.id;
  });

  it("completes provider signup: pending profile + doctor role + events", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.completeProviderSignup",
      headers: { cookie: providerCookie, "content-type": "application/json" },
      payload: { providerType: "doctor", phone: "+9647705000001" },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().result.data;
    expect(data.status).toBe("pending");
    providerProfileId = data.providerProfileId;

    const roles = await app.kernel.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, providerUserId));
    expect(roles.map((r) => r.role)).toEqual(["doctor"]);

    const events = await app.kernel.db.select().from(domainEvents);
    const registered = events.filter((e) => e.name === "identity.user_registered.v1");
    expect(registered).toHaveLength(1);
    expect((registered[0]?.payload as { userType: string }).userType).toBe("provider");

    // Idempotent: calling again returns the same profile, emits nothing new.
    const again = await app.inject({
      method: "POST",
      url: "/trpc/identity.completeProviderSignup",
      headers: { cookie: providerCookie, "content-type": "application/json" },
      payload: { providerType: "doctor", phone: "+9647705000001" },
    });
    expect(again.json().result.data.providerProfileId).toBe(providerProfileId);
    const eventsAfter = await app.kernel.db.select().from(domainEvents);
    expect(eventsAfter.filter((e) => e.name === "identity.user_registered.v1")).toHaveLength(1);
  });

  it("a patient without a verified email cannot become a provider", async () => {
    const phone = "+9647705000002";
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        name: "Patient",
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
    const patientCookie = cookieFrom(verify);

    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.completeProviderSignup",
      headers: { cookie: patientCookie, "content-type": "application/json" },
      payload: { providerType: "doctor", phone },
    });
    expect(res.statusCode).toBe(412);
    expect(res.json().error.data.appCode).toBe("EMAIL_NOT_VERIFIED");
  });

  it("pending provider can log in and see status but is NOT publicly visible", async () => {
    const status = await app.inject({
      method: "GET",
      url: `/trpc/identity.myProviderStatus`,
      headers: { cookie: providerCookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().result.data.status).toBe("pending");

    expect(await isProviderPubliclyVisible(app.kernel.db, providerUserId)).toBe(false);
    expect(await listApprovedProviders(app.kernel.db)).toHaveLength(0);
  });

  it("admin approves: status flips, event emitted, provider becomes visible", async () => {
    adminCookie = await registerVerifiedUser("admin@example.com", "Admin");
    const [adminRow] = await app.kernel.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "admin@example.com"));
    await app.kernel.db.insert(userRoles).values({ userId: adminRow!.id, role: "admin" });

    const pending = await app.inject({
      method: "GET",
      url: "/trpc/identity.listPendingProviders",
      headers: { cookie: adminCookie },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().result.data.map((p: { providerProfileId: string }) => p.providerProfileId)).toContain(
      providerProfileId,
    );

    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.setProviderStatus",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { providerProfileId, status: "approved" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.status).toBe("approved");

    expect(await isProviderPubliclyVisible(app.kernel.db, providerUserId)).toBe(true);
    expect((await listApprovedProviders(app.kernel.db)).map((p) => p.userId)).toContain(
      providerUserId,
    );

    const events = await app.kernel.db.select().from(domainEvents);
    const changed = events.filter((e) => e.name === "identity.provider_status_changed.v1");
    expect(changed).toHaveLength(1);
    expect(changed[0]?.payload).toMatchObject({ from: "pending", to: "approved" });
  });

  it("rejects a same-status transition with INVALID_STATUS_TRANSITION", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.setProviderStatus",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { providerProfileId, status: "approved" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.data.appCode).toBe("INVALID_STATUS_TRANSITION");
  });

  it("admin rejects another provider with a reason; not visible", async () => {
    const cookie = await registerVerifiedUser("doctor2@example.com", "Dr. Second");
    const complete = await app.inject({
      method: "POST",
      url: "/trpc/identity.completeProviderSignup",
      headers: { cookie, "content-type": "application/json" },
      payload: { providerType: "laboratory", phone: "+9647705000003" },
    });
    const secondId = complete.json().result.data.providerProfileId;

    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.setProviderStatus",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { providerProfileId: secondId, status: "rejected", reason: "incomplete documents" },
    });
    expect(res.statusCode).toBe(200);

    const status = await app.inject({
      method: "GET",
      url: "/trpc/identity.myProviderStatus",
      headers: { cookie },
    });
    expect(status.json().result.data.status).toBe("rejected");
    expect(status.json().result.data.rejectionReason).toBe("incomplete documents");

    const [profile] = await app.kernel.db
      .select({ userId: providerProfiles.userId })
      .from(providerProfiles)
      .where(eq(providerProfiles.id, secondId));
    expect(await isProviderPubliclyVisible(app.kernel.db, profile!.userId)).toBe(false);
  });

  it("admin manual recovery: new password works, old sessions revoked, audit event emitted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.recoverProviderAccount",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: {
        providerProfileId,
        newPassword: "brand new password 42",
        reason: "identity verified over the phone",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.sessionsRevoked).toBe(true);

    // Old session is dead.
    const whoami = await app.inject({
      method: "GET",
      url: "/trpc/system.whoami",
      headers: { cookie: providerCookie },
    });
    expect(whoami.json().result.data.userId).toBeNull();

    // Old password no longer works; the new one does.
    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "doctor@example.com", password: PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "doctor@example.com", password: "brand new password 42" },
    });
    expect(newLogin.statusCode).toBe(200);

    const events = await app.kernel.db.select().from(domainEvents);
    const recovered = events.filter((e) => e.name === "identity.provider_recovered.v1");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.payload).toMatchObject({
      providerProfileId,
      reason: "identity verified over the phone",
    });
  });

  it("revokeOtherSessions keeps the calling session and kills the rest", async () => {
    const loginA = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "doctor@example.com", password: "brand new password 42" },
    });
    const loginB = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "doctor@example.com", password: "brand new password 42" },
    });
    const cookieA = cookieFrom(loginA);
    const cookieB = cookieFrom(loginB);

    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.revokeOtherSessions",
      headers: { cookie: cookieB, "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.revoked).toBe(true);

    const a = await app.inject({
      method: "GET",
      url: "/trpc/system.whoami",
      headers: { cookie: cookieA },
    });
    expect(a.json().result.data.userId).toBeNull();
    const b = await app.inject({
      method: "GET",
      url: "/trpc/system.whoami",
      headers: { cookie: cookieB },
    });
    expect(b.json().result.data.userId).toBeTruthy();
  });
});
