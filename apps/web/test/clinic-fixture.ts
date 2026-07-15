import { createMockOtpChannel } from "@mesomed/platform";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { doctorProfiles, eq, providerProfiles, providers, user, userRoles } from "@mesomed/db";
import { buildServer } from "@mesomed/api/app";
import { loadEnv } from "@mesomed/api/env";
import { ACCOUNTS, createClinicClient, PASSWORD, TIME_ZONE } from "./clinic-client.js";

/**
 * Web clinic harness (Phase 9c Slice 3): a live API with REAL browser-style
 * sessions — accounts sign in over Better Auth's email endpoint exactly as
 * the web sign-in page does. Node-only (embedded Postgres + Fastify), so it
 * runs from global-setup.ts; the jsdom render suite reaches it through the
 * HTTP-only helpers in clinic-client.ts. Clinic structure is seeded through
 * the real admin API over HTTP; identity/directory scaffolding rows are
 * inserted directly (their creation flows are proven in the Phase 2/3
 * suites), mirroring the mobile clinic fixture.
 */

export interface WebClinicHarness {
  baseURL: string;
  doctorLocationId: string;
  close(): Promise<void>;
}

export async function setupWebClinicHarness(): Promise<WebClinicHarness> {
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

  /** Real credential sign-up over the web wire path; email verified
   * directly — the verification flow itself is proven in Phase 2. */
  async function signUp(account: { email: string; name: string }): Promise<string> {
    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: account.name, email: account.email, password: PASSWORD }),
    });
    if (signup.status !== 200) {
      throw new Error(`sign-up failed for ${account.email}: ${signup.status}`);
    }
    const created = (await signup.json()) as { user: { id: string } };
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, created.user.id));
    return created.user.id;
  }

  const doctorUserId = await signUp(ACCOUNTS.doctor);
  const adminUserId = await signUp(ACCOUNTS.admin);
  const secretaryUserId = await signUp(ACCOUNTS.secretary);
  await db.insert(userRoles).values([
    { userId: doctorUserId, role: "doctor" },
    { userId: adminUserId, role: "admin" },
    { userId: secretaryUserId, role: "secretary" },
  ]);

  const [profile] = await db
    .insert(providerProfiles)
    .values({
      userId: doctorUserId,
      providerType: "doctor",
      status: "approved",
      phone: "+9647709200001",
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
      slug: `web-clinic-doctor-${process.pid}`,
      nameEn: "Web Clinic Doctor",
      nameAr: "Web Clinic Doctor",
      nameCkb: "Web Clinic Doctor",
      specialtyKey: "cardiology",
      publiclyVisible: true,
    })
    .returning({ id: doctorProfiles.id });

  // Clinic structure through the real admin API over HTTP. The client's
  // doctorLocationId isn't known yet, so seed with a placeholder client.
  const seeder = createClinicClient(baseURL, "");
  const adminCookie = await seeder.signInCookie(ACCOUNTS.admin.email);
  async function seedMutation<T>(path: string, input: unknown): Promise<T> {
    const res = await seeder.rpc<T>(path, "mutation", input, adminCookie);
    if (res.status !== 200 || res.data === null) {
      throw new Error(`${path} failed in fixture: ${res.status} ${res.appCode ?? ""}`);
    }
    return res.data;
  }

  const location = await seedMutation<{ id: string }>("scheduling.upsertLocation", {
    slug: `web-clinic-${process.pid}`,
    name: { en: "Web Clinic", ar: "عيادة", ckb: "کلینیک" },
    timeZone: TIME_ZONE,
  });
  const link = await seedMutation<{ doctorLocationId: string }>("scheduling.linkDoctorLocation", {
    doctorProfileId: doctor!.id,
    locationId: location.id,
  });
  const doctorLocationId = link.doctorLocationId;
  await seedMutation("scheduling.assignSecretary", { secretaryUserId, doctorLocationId });
  await seedMutation("scheduling.setWeeklySchedule", {
    doctorLocationId,
    schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      startTime: "09:00",
      endTime: "17:00",
      slotDurationMinutes: 30,
      breaks: [],
    })),
  });

  return {
    baseURL,
    doctorLocationId,
    close: async () => {
      await app.close();
      await tdb.close();
    },
  };
}
