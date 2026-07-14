import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockOtpChannel } from "@mesomed/platform";
import { placeholderEmailForPhone } from "@mesomed/domain/identity";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { doctorProfiles, providerProfiles, providers, userRoles } from "@mesomed/db";
import { buildServer } from "@mesomed/api/app";
import { loadEnv } from "@mesomed/api/env";
import { createMobileAuthClient, type AuthClientStorage } from "../lib/create-auth-client.js";

const DOCTOR_PHONE = "+9647709100001";
const ADMIN_PHONE = "+9647709100002";
const PASSWORD = "correct horse battery";

function memoryStorage(): AuthClientStorage {
  const store = new Map<string, string>();
  return {
    setItem: (key, value) => {
      store.set(key, value);
    },
    getItem: (key) => store.get(key) ?? null,
  };
}

/**
 * Phase 9b Slice 3 (read-only provider queue): a doctor signs in on the
 * REAL mobile auth client and lists a seeded clinic day over the same
 * wire path the app uses — tRPC over HTTP with the secure-store session
 * cookie attached via authClient.getCookie() (app/_layout.tsx). Sessions
 * here are REAL (Better Auth + user_roles), not the api suite's header
 * doubles, so this also proves role resolution end to end: identity.me
 * carries the doctor role (the account tab's clinic-entry gate),
 * myWorkplaces binds the owning-doctor relation, and clinicDay serves
 * server-computed allowedActions (MM-QA-003 F-07).
 */
describe("provider clinic queue via the real mobile client", () => {
  let tdb: TestDatabase;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseURL = "";
  let doctorLocationId = "";
  let bookedStartsAt = "";
  const whatsapp = createMockOtpChannel("whatsapp");
  const sms = createMockOtpChannel("sms");

  async function rpc<T>(
    path: string,
    kind: "query" | "mutation",
    input?: unknown,
    cookie?: string,
  ): Promise<{ status: number; data: T | null }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers["cookie"] = cookie;
    const res =
      kind === "query"
        ? await fetch(
            `${baseURL}/trpc/${path}${
              input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`
            }`,
            { headers },
          )
        : await fetch(`${baseURL}/trpc/${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(input ?? {}),
          });
    const body = (await res.json()) as { result?: { data: T } };
    return { status: res.status, data: body.result?.data ?? null };
  }

  async function seedMutation<T>(path: string, input: unknown, cookie: string): Promise<T> {
    const res = await rpc<T>(path, "mutation", input, cookie);
    if (res.status !== 200 || res.data === null) {
      throw new Error(`${path} failed in fixture: ${res.status}`);
    }
    return res.data;
  }

  /** Register + phone-verify a real credential account; returns the user id. */
  async function signUpAndVerify(phone: string, name: string): Promise<string> {
    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        email: placeholderEmailForPhone(phone),
        password: PASSWORD,
        phoneNumber: phone,
      }),
    });
    expect(signup.status).toBe(200);
    const created = (await signup.json()) as { user: { id: string } };
    await fetch(`${baseURL}/api/auth/phone-number/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    });
    const verify = await fetch(`${baseURL}/api/auth/phone-number/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone, code: whatsapp.sent.at(-1)?.code }),
    });
    expect(verify.status).toBe(200);
    return created.user.id;
  }

  async function signInCookie(phone: string): Promise<string> {
    const client = createMobileAuthClient({ baseURL, storage: memoryStorage() });
    const signIn = await client.signIn.phoneNumber({ phoneNumber: phone, password: PASSWORD });
    expect(signIn.error).toBeNull();
    const cookie = client.getCookie();
    expect(cookie).toContain("session_token");
    return cookie;
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: tdb.connectionString,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
    });
    app = await buildServer(env, { otpChannels: { whatsapp, sms } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    baseURL = `http://127.0.0.1:${address.port}`;
    const { db } = app.kernel;

    // Real accounts; clinic-side roles land in the module-owned
    // user_roles table exactly as identity's admin flows would put them.
    const doctorUserId = await signUpAndVerify(DOCTOR_PHONE, "Mobile Doctor");
    const adminUserId = await signUpAndVerify(ADMIN_PHONE, "Mobile Admin");
    await db.insert(userRoles).values([
      { userId: doctorUserId, role: "doctor" },
      { userId: adminUserId, role: "admin" },
    ]);

    // Directory rows for the doctor (identity/directory creation flows are
    // proven in their own suites; this is scaffolding, same as the api
    // booking fixture).
    const [profile] = await db
      .insert(providerProfiles)
      .values({
        userId: doctorUserId,
        providerType: "doctor",
        status: "approved",
        phone: DOCTOR_PHONE,
      })
      .returning({ id: providerProfiles.id });
    const [provider] = await db
      .insert(providers)
      .values({ providerType: "doctor", identityProfileId: profile!.id, approved: true })
      .returning({ id: providers.id });
    const [doctor] = await db
      .insert(doctorProfiles)
      .values({
        providerId: provider!.id,
        slug: `mobile-clinic-doctor-${process.pid}`,
        nameEn: "Mobile Clinic Doctor",
        nameAr: "Mobile Clinic Doctor",
        nameCkb: "Mobile Clinic Doctor",
        specialtyKey: "cardiology",
        publiclyVisible: true,
      })
      .returning({ id: doctorProfiles.id });

    // Clinic structure through the real admin API over HTTP.
    const adminCookie = await signInCookie(ADMIN_PHONE);
    const location = await seedMutation<{ id: string }>(
      "scheduling.upsertLocation",
      { slug: `mobile-clinic-${process.pid}`, name: { en: "Clinic", ar: "عيادة", ckb: "کلینیک" } },
      adminCookie,
    );
    const link = await seedMutation<{ doctorLocationId: string }>(
      "scheduling.linkDoctorLocation",
      { doctorProfileId: doctor!.id, locationId: location.id },
      adminCookie,
    );
    doctorLocationId = link.doctorLocationId;
    await seedMutation(
      "scheduling.setWeeklySchedule",
      {
        doctorLocationId,
        schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: "09:00",
          endTime: "17:00",
          slotDurationMinutes: 30,
          breaks: [],
        })),
      },
      adminCookie,
    );

    // One guest booking a week out — the queue item under test.
    const anchor = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const availability = await rpc<{
      days: Array<{ isPast: boolean; slots: Array<{ startsAt: string }> }>;
    }>("booking.weekAvailability", "query", { doctorLocationId, anchor });
    const slot = availability.data?.days
      .filter((day) => !day.isPast)
      .flatMap((day) => day.slots)[0];
    if (!slot) throw new Error("no open slot in fixture");
    bookedStartsAt = slot.startsAt;
    const booked = await rpc("booking.guestBook", "mutation", {
      doctorLocationId,
      startsAt: bookedStartsAt,
      patient: { fullName: "Queue Patient", phone: "+9647709100003" },
    });
    expect(booked.status).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("signs the doctor in and lists the clinic day with server-computed allowedActions", async () => {
    const cookie = await signInCookie(DOCTOR_PHONE);

    // Role-aware entry: identity.me carries the clinic-side role the
    // account tab gates the /clinic link on.
    const me = await rpc<{ roles: string[] }>("identity.me", "query", undefined, cookie);
    expect(me.status).toBe(200);
    expect(me.data?.roles).toContain("doctor");

    // Workplace picker: the doctor's own location, bound as owning_doctor.
    const workplaces = await rpc<{
      workplaces: Array<{ doctorLocationId: string; relation: string }>;
    }>("scheduling.myWorkplaces", "query", undefined, cookie);
    expect(workplaces.status).toBe(200);
    expect(workplaces.data?.workplaces).toHaveLength(1);
    expect(workplaces.data?.workplaces[0]).toMatchObject({
      doctorLocationId,
      relation: "owning_doctor",
    });

    // Day queue: the booked appointment with the doctor's affordances,
    // straight from the server (no client status rules — F-07).
    const day = await rpc<{
      appointments: Array<{
        startsAt: string;
        status: string;
        patientName: string | null;
        allowedActions: string[];
      }>;
    }>("booking.clinicDay", "query", { doctorLocationId, anchor: bookedStartsAt }, cookie);
    expect(day.status).toBe(200);
    const item = day.data?.appointments.find((a) => a.startsAt === bookedStartsAt);
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      status: "booked",
      patientName: "Queue Patient",
      allowedActions: ["confirm", "cancel"],
    });
  });

  it("denies the clinic day to an anonymous session (layer a)", async () => {
    const anonymous = await rpc("booking.clinicDay", "query", {
      doctorLocationId,
      anchor: bookedStartsAt,
    });
    expect(anonymous.status).toBe(401);
  });
});
