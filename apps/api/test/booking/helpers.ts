import type { FastifyInstance } from "fastify";
import type { Role } from "@mesomed/contracts/roles";
import { doctorProfiles, patientProfiles, providerProfiles, providers, user } from "@mesomed/db";
import { buildServer } from "../../src/app.js";
import type { HandlerRegistry } from "../../src/kernel/events.js";
import { testEnv } from "../helpers.js";

/**
 * Phase 4 test app: the real composition root with a header-injected
 * session (x-test-user + x-test-roles) so layer-b ownership checks can be
 * exercised across distinct users (real-session integration is proven in
 * the identity suites). A pre-seeded handler registry can be passed to
 * observe event delivery with test-double subscribers — module subscribers
 * are registered on top of it by the composition root.
 */
export function buildBookingTestServer(
  connectionString: string,
  overrides: { eventHandlers?: HandlerRegistry } = {},
): Promise<FastifyInstance> {
  return buildServer(testEnv(connectionString), {
    eventHandlers: overrides.eventHandlers,
    sessionResolver: (req) => {
      const roleHeader = req.headers["x-test-roles"];
      const roles = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader;
      if (roles === undefined) return null;
      const userHeader = req.headers["x-test-user"];
      const userId = (Array.isArray(userHeader) ? userHeader[0] : userHeader) ?? "user-under-test";
      return { userId, roles: roles === "" ? [] : (roles.split(",") as Role[]) };
    },
  });
}

export interface CallOptions {
  roles?: string;
  user?: string;
}

/** Invoke a tRPC procedure through the real HTTP surface. */
export async function trpc(
  app: FastifyInstance,
  procedure: string,
  kind: "query" | "mutation",
  input?: unknown,
  options: CallOptions = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.roles !== undefined) headers["x-test-roles"] = options.roles;
  if (options.user !== undefined) headers["x-test-user"] = options.user;

  if (kind === "query") {
    const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    return app.inject({ method: "GET", url: `/trpc/${procedure}${query}`, headers });
  }
  return app.inject({
    method: "POST",
    url: `/trpc/${procedure}`,
    headers,
    payload: input === undefined ? {} : JSON.stringify(input),
  });
}

/** Unwrap a successful tRPC response body. */
export function result<T>(res: { json(): unknown }): T {
  return (res.json() as { result: { data: T } }).result.data;
}

export const ADMIN = { roles: "admin" } satisfies CallOptions;

export const NAME = { en: "Test Clinic", ar: "عيادة", ckb: "کلینیک" };

export interface ClinicFixture {
  doctorUserId: string;
  otherDoctorUserId: string;
  secretaryUserId: string;
  otherSecretaryUserId: string;
  patientUserId: string;
  otherPatientUserId: string;
  patientPhone: string;
  otherPatientPhone: string;
  doctorProfileId: string;
  otherDoctorProfileId: string;
  locationId: string;
  doctorLocationId: string;
  otherDoctorLocationId: string;
}

let fixtureCounter = 0;

/**
 * A clinic under test: two approved doctors each linked to a location
 * (only the first has a secretary assigned and a weekly schedule), plus a
 * claimed patient profile. Identity/directory rows are inserted directly —
 * their creation flows are proven in the Phase 2/3 suites; this fixture is
 * scaffolding, not the system under test.
 */
export async function seedClinic(app: FastifyInstance): Promise<ClinicFixture> {
  const db = app.kernel.db;
  const n = ++fixtureCounter;
  const suffix = `${process.pid}-${n}`;

  async function insertUser(id: string): Promise<string> {
    const userId = `${id}-${suffix}`;
    await db.insert(user).values({
      id: userId,
      name: userId,
      email: `${userId}@test.mesomed.example`,
      emailVerified: true,
    });
    return userId;
  }

  async function insertDoctor(userId: string, slug: string): Promise<string> {
    const [profile] = await db
      .insert(providerProfiles)
      .values({ userId, providerType: "doctor", status: "approved", phone: "+9647700000000" })
      .returning({ id: providerProfiles.id });
    const [provider] = await db
      .insert(providers)
      .values({ providerType: "doctor", identityProfileId: profile!.id, approved: true })
      .returning({ id: providers.id });
    const [doctor] = await db
      .insert(doctorProfiles)
      .values({
        providerId: provider!.id,
        slug: `${slug}-${suffix}`,
        nameEn: slug,
        nameAr: slug,
        nameCkb: slug,
        specialtyKey: "cardiology",
        publiclyVisible: true,
      })
      .returning({ id: doctorProfiles.id });
    return doctor!.id;
  }

  const doctorUserId = await insertUser("doctor-user");
  const otherDoctorUserId = await insertUser("other-doctor-user");
  const secretaryUserId = await insertUser("secretary-user");
  const otherSecretaryUserId = await insertUser("other-secretary-user");
  const patientUserId = await insertUser("patient-user");
  const otherPatientUserId = await insertUser("other-patient-user");

  const doctorProfileId = await insertDoctor(doctorUserId, "dr-under-test");
  const otherDoctorProfileId = await insertDoctor(otherDoctorUserId, "dr-other");

  const patientPhone = `+96477010${String(n).padStart(5, "0")}`;
  const otherPatientPhone = `+96477020${String(n).padStart(5, "0")}`;
  await db.insert(patientProfiles).values([
    {
      userId: patientUserId,
      normalizedPhone: patientPhone,
      fullName: "Claimed Patient",
      claimedAt: new Date(),
    },
    {
      userId: otherPatientUserId,
      normalizedPhone: otherPatientPhone,
      fullName: "Other Patient",
      claimedAt: new Date(),
    },
  ]);

  async function mutate<T>(procedure: string, input: unknown): Promise<T> {
    const res = await trpc(app, procedure, "mutation", input, ADMIN);
    if (res.statusCode !== 200) {
      throw new Error(`${procedure} failed in fixture: ${res.statusCode} ${res.body}`);
    }
    return result<T>(res);
  }

  const location = await mutate<{ id: string }>("scheduling.upsertLocation", {
    slug: `clinic-${suffix}`,
    name: NAME,
  });
  const link = await mutate<{ doctorLocationId: string }>("scheduling.linkDoctorLocation", {
    doctorProfileId,
    locationId: location.id,
  });
  const otherLink = await mutate<{ doctorLocationId: string }>("scheduling.linkDoctorLocation", {
    doctorProfileId: otherDoctorProfileId,
    locationId: location.id,
  });
  await mutate("scheduling.assignSecretary", {
    secretaryUserId,
    doctorLocationId: link.doctorLocationId,
  });
  await mutate("scheduling.setWeeklySchedule", {
    doctorLocationId: link.doctorLocationId,
    schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      startTime: "09:00",
      endTime: "17:00",
      slotDurationMinutes: 30,
      breaks: [{ startTime: "12:00", endTime: "13:00" }],
    })),
  });

  return {
    doctorUserId,
    otherDoctorUserId,
    secretaryUserId,
    otherSecretaryUserId,
    patientUserId,
    otherPatientUserId,
    patientPhone,
    otherPatientPhone,
    doctorProfileId,
    otherDoctorProfileId,
    locationId: location.id,
    doctorLocationId: link.doctorLocationId,
    otherDoctorLocationId: otherLink.doctorLocationId,
  };
}

interface WeekDay {
  date: string;
  isPast: boolean;
  slots: Array<{ startsAt: string; endsAt: string }>;
}

/**
 * Open slots of the week one week out — far enough that "past" never
 * interferes, fresh enough that prior bookings in the same suite are
 * reflected.
 */
export async function openSlotsNextWeek(
  app: FastifyInstance,
  doctorLocationId: string,
): Promise<Array<{ startsAt: string; endsAt: string }>> {
  const anchor = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await trpc(app, "booking.weekAvailability", "query", { doctorLocationId, anchor });
  if (res.statusCode !== 200) {
    throw new Error(`weekAvailability failed: ${res.statusCode} ${res.body}`);
  }
  const { days } = result<{ days: WeekDay[] }>(res);
  return days.filter((d) => !d.isPast).flatMap((d) => d.slots);
}

let guestPhoneCounter = 0;

/** A unique, valid Iraqi mobile number per call. */
export function nextGuestPhone(): string {
  return `+96477400${String(++guestPhoneCounter + (process.pid % 90) * 1000).padStart(5, "0")}`;
}
