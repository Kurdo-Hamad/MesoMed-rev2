import { expect } from "vitest";
import { createMockOtpChannel } from "@mesomed/platform";
import { placeholderEmailForPhone } from "@mesomed/domain/identity";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { doctorProfiles, providerProfiles, providers, userRoles } from "@mesomed/db";
import { buildServer } from "@mesomed/api/app";
import { loadEnv } from "@mesomed/api/env";
import { createMobileAuthClient, type AuthClientStorage } from "../lib/create-auth-client.js";

/**
 * Shared clinic harness for the mobile provider-queue suites (Slices 3/4):
 * a live API with REAL sessions (Better Auth + user_roles — not the api
 * suite's header doubles). Accounts are real credential sign-ups; clinic
 * structure is seeded through the real admin API over HTTP; tRPC calls
 * attach the secure-store session cookie via authClient.getCookie(),
 * exactly as app/_layout.tsx wires the app's own tRPC link.
 */

export const PHONES = {
  doctor: "+9647709100001",
  admin: "+9647709100002",
  /** Registered patient — bookings on this phone bind patient_owner. */
  patient: "+9647709100003",
  secretary: "+9647709100004",
  /** Carries the secretary role but NO assignment — layer-b denial actor. */
  outsiderSecretary: "+9647709100005",
} as const;
export const PASSWORD = "correct horse battery";

function memoryStorage(): AuthClientStorage {
  const store = new Map<string, string>();
  return {
    setItem: (key, value) => {
      store.set(key, value);
    },
    getItem: (key) => store.get(key) ?? null,
  };
}

export interface RpcResult<T> {
  status: number;
  data: T | null;
  /** Typed error code per convention #11 (clients read appCode, never messages). */
  appCode: string | null;
}

export interface ClinicHarness {
  app: Awaited<ReturnType<typeof buildServer>>;
  baseURL: string;
  doctorLocationId: string;
  rpc<T>(
    path: string,
    kind: "query" | "mutation",
    input?: unknown,
    cookie?: string,
  ): Promise<RpcResult<T>>;
  signInCookie(phone: string): Promise<string>;
  /** Guest-books the next open slot a week out; returns the queue item.
   * Passing a registered phone links the appointment to that patient. */
  bookSlot(phone?: string): Promise<{ appointmentId: string; startsAt: string }>;
  close(): Promise<void>;
}

export async function setupClinicHarness(): Promise<ClinicHarness> {
  const whatsapp = createMockOtpChannel("whatsapp");
  const sms = createMockOtpChannel("sms");
  const tdb: TestDatabase = await createTestDatabase();
  const env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: tdb.connectionString,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
  });
  const app = await buildServer(env, { otpChannels: { whatsapp, sms } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  const baseURL = `http://127.0.0.1:${address.port}`;
  const { db } = app.kernel;

  async function rpc<T>(
    path: string,
    kind: "query" | "mutation",
    input?: unknown,
    cookie?: string,
  ): Promise<RpcResult<T>> {
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
    const body = (await res.json()) as {
      result?: { data: T };
      error?: { data?: { appCode?: string } };
    };
    return {
      status: res.status,
      data: body.result?.data ?? null,
      appCode: body.error?.data?.appCode ?? null,
    };
  }

  async function seedMutation<T>(path: string, input: unknown, cookie: string): Promise<T> {
    const res = await rpc<T>(path, "mutation", input, cookie);
    if (res.status !== 200 || res.data === null) {
      throw new Error(`${path} failed in fixture: ${res.status} ${res.appCode ?? ""}`);
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

  // Real accounts; clinic-side roles land in the module-owned user_roles
  // table exactly as identity's admin flows would put them.
  const doctorUserId = await signUpAndVerify(PHONES.doctor, "Mobile Doctor");
  const adminUserId = await signUpAndVerify(PHONES.admin, "Mobile Admin");
  const secretaryUserId = await signUpAndVerify(PHONES.secretary, "Mobile Secretary");
  const outsiderUserId = await signUpAndVerify(PHONES.outsiderSecretary, "Outsider Secretary");
  // Patient role + profile claim ride the phone-verification hook —
  // a later guest booking on this phone binds patient_owner (MM-DEC §2).
  await signUpAndVerify(PHONES.patient, "Mobile Patient");
  await db.insert(userRoles).values([
    { userId: doctorUserId, role: "doctor" },
    { userId: adminUserId, role: "admin" },
    { userId: secretaryUserId, role: "secretary" },
    { userId: outsiderUserId, role: "secretary" },
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
      phone: PHONES.doctor,
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
  const adminCookie = await signInCookie(PHONES.admin);
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
  const doctorLocationId = link.doctorLocationId;
  await seedMutation(
    "scheduling.assignSecretary",
    { secretaryUserId, doctorLocationId },
    adminCookie,
  );
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

  let guestPhoneCounter = 0;
  const slotCursor = { taken: new Set<string>() };

  async function bookSlot(phone?: string): Promise<{ appointmentId: string; startsAt: string }> {
    const anchor = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const availability = await rpc<{
      days: Array<{ isPast: boolean; slots: Array<{ startsAt: string }> }>;
    }>("booking.weekAvailability", "query", { doctorLocationId, anchor });
    const slot = availability.data?.days
      .filter((day) => !day.isPast)
      .flatMap((day) => day.slots)
      .find((candidate) => !slotCursor.taken.has(candidate.startsAt));
    if (!slot) throw new Error("no open slot in fixture");
    slotCursor.taken.add(slot.startsAt);
    const guestPhone = phone ?? `+96477091100${String(++guestPhoneCounter).padStart(2, "0")}`;
    const booked = await rpc<{ appointmentId: string }>("booking.guestBook", "mutation", {
      doctorLocationId,
      startsAt: slot.startsAt,
      patient: { fullName: "Queue Patient", phone: guestPhone },
    });
    if (booked.status !== 200 || booked.data === null) {
      throw new Error(`guestBook failed in fixture: ${booked.status}`);
    }
    return { appointmentId: booked.data.appointmentId, startsAt: slot.startsAt };
  }

  return {
    app,
    baseURL,
    doctorLocationId,
    rpc,
    signInCookie,
    bookSlot,
    close: async () => {
      await app.close();
      await tdb.close();
    },
  };
}
