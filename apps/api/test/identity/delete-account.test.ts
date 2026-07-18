import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Role } from "@mesomed/contracts/roles";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  abuseAlerts,
  account,
  appointments,
  clinicalAccessLog,
  deviceTokens,
  doctorProfiles,
  domainEvents,
  encounters,
  eq,
  notificationLog,
  patientProfiles,
  prescriptions,
  providerProfiles,
  providers,
  sendRateEvents,
  session,
  user,
  userRoles,
  visitNotes,
} from "@mesomed/db";
import { buildServer } from "../../src/app.js";
import { testEnv, waitFor } from "../helpers.js";

/**
 * Self-service account deletion (MM-QA-004 F-02): the flow must execute
 * the retention-erasure runbook's matrix (docs/runbooks/
 * data-retention-erasure.md §1) — each table's row below asserts its
 * prescribed disposition. A second, untouched account proves the flow is
 * scoped to the caller (self-only). Session is injected by the test-header
 * resolver so the call runs as a specific seeded user.
 */
describe("account deletion — runbook erasure matrix (MM-QA-004 F-02)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString), {
      sessionResolver: (req) => {
        const roleHeader = req.headers["x-test-roles"];
        const roles = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader;
        if (roles === undefined) return null;
        const userHeader = req.headers["x-test-user"];
        const userId =
          (Array.isArray(userHeader) ? userHeader[0] : userHeader) ?? "user-under-test";
        return { userId, roles: roles === "" ? [] : (roles.split(",") as Role[]) };
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  function deleteAccountAs(userId: string) {
    return app.inject({
      method: "POST",
      url: "/trpc/identity.deleteAccount",
      headers: {
        "content-type": "application/json",
        "x-test-roles": "patient",
        "x-test-user": userId,
      },
      payload: {},
    });
  }

  async function seedAccount(opts: {
    userId: string;
    phone: string;
    doctorProfileId: string;
    locationId: string;
    startsAt: Date;
  }) {
    const { db } = app.kernel;
    const endsAt = new Date(opts.startsAt.getTime() + 30 * 60_000);
    await db.insert(user).values({
      id: opts.userId,
      name: `Name ${opts.userId}`,
      email: `${opts.userId}@test.mesomed.example`,
      emailVerified: true,
      phoneNumber: opts.phone,
      phoneNumberVerified: true,
    });
    await db.insert(userRoles).values({ userId: opts.userId, role: "patient" });
    await db.insert(session).values({
      id: `sess-${opts.userId}`,
      token: `token-${opts.userId}`,
      userId: opts.userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(account).values({
      id: `acct-${opts.userId}`,
      accountId: opts.userId,
      providerId: "credential",
      userId: opts.userId,
      password: "hashed",
    });
    await db.insert(deviceTokens).values({
      userId: opts.userId,
      token: `expo-${opts.userId}`,
      platform: "ios",
    });
    const [profile] = await db
      .insert(patientProfiles)
      .values({
        userId: opts.userId,
        normalizedPhone: opts.phone,
        fullName: `Name ${opts.userId}`,
        email: `${opts.userId}@test.mesomed.example`,
        dateOfBirth: "1990-01-01",
        gender: "male",
        claimedAt: new Date(),
      })
      .returning({ id: patientProfiles.id });
    const profileId = profile!.id;

    // Account-holder and guest-era notification rows both belong to the subject.
    await db.insert(notificationLog).values([
      {
        userId: opts.userId,
        template: "reminder",
        channel: "whatsapp",
        destination: opts.phone,
        locale: "ckb",
        dedupeKey: `del-user:${opts.userId}`,
      },
      {
        patientProfileId: profileId,
        template: "booking_confirmation",
        channel: "sms",
        destination: opts.phone,
        locale: "ckb",
        dedupeKey: `del-profile:${profileId}`,
      },
    ]);

    // Phone-keyed kernel abuse/rate rows for this subject.
    await db.insert(sendRateEvents).values({ scope: "phone", key: opts.phone });
    await db.insert(abuseAlerts).values({ kind: "velocity", channel: "whatsapp", key: opts.phone });

    // Clinical record (retained forever) referencing this profile.
    const [appt] = await db
      .insert(appointments)
      .values({
        doctorLocationId: opts.locationId,
        patientProfileId: profileId,
        startsAt: opts.startsAt,
        endsAt,
        bookedVia: "patient_account",
      })
      .returning({ id: appointments.id });
    const [enc] = await db
      .insert(encounters)
      .values({
        appointmentId: appt!.id,
        doctorProfileId: opts.doctorProfileId,
        patientProfileId: profileId,
        startsAt: opts.startsAt,
        endsAt,
      })
      .returning({ id: encounters.id });
    await db.insert(visitNotes).values({
      encounterId: enc!.id,
      authorUserId: opts.doctorProfileId,
      content: "note",
    });
    await db.insert(prescriptions).values({
      encounterId: enc!.id,
      doctorProfileId: opts.doctorProfileId,
      patientProfileId: profileId,
      medicationName: "Amoxicillin",
      dosage: "500mg",
      frequency: "twice daily",
      duration: "7 days",
    });
    await db.insert(clinicalAccessLog).values({
      actorUserId: opts.doctorProfileId,
      action: "encounter_created",
      encounterId: enc!.id,
    });

    return { profileId, appointmentId: appt!.id, encounterId: enc!.id };
  }

  it("executes every runbook matrix row for the caller, and only the caller", async () => {
    const subjectPhone = "+9647701110001";
    const controlPhone = "+9647701110002";
    const doctorProfileId = "00000000-0000-0000-0000-0000000000d1";
    const subject = await seedAccount({
      userId: "delete-subject",
      phone: subjectPhone,
      doctorProfileId,
      locationId: "00000000-0000-0000-0000-0000000000a1",
      startsAt: new Date("2026-01-01T09:00:00Z"),
    });
    const control = await seedAccount({
      userId: "delete-control",
      phone: controlPhone,
      doctorProfileId,
      locationId: "00000000-0000-0000-0000-0000000000a2",
      startsAt: new Date("2026-01-01T10:00:00Z"),
    });

    const { db } = app.kernel;

    // clinical_access_log is append-only and populated by the audit trigger
    // on the seeded clinical writes; capture its count so "kept" is proven
    // as "unchanged by deletion" rather than an exact seeded number.
    const clinicalLogBefore = (
      await db
        .select()
        .from(clinicalAccessLog)
        .where(eq(clinicalAccessLog.encounterId, subject.encounterId))
    ).length;
    expect(clinicalLogBefore).toBeGreaterThan(0);

    const res = await deleteAccountAs("delete-subject");
    expect(res.statusCode).toBe(200);

    // user / auth tables → account deletion (user + cascades).
    expect(await db.select().from(user).where(eq(user.id, "delete-subject"))).toHaveLength(0);
    expect(
      await db.select().from(session).where(eq(session.userId, "delete-subject")),
    ).toHaveLength(0);
    expect(
      await db.select().from(account).where(eq(account.userId, "delete-subject")),
    ).toHaveLength(0);
    expect(
      await db.select().from(userRoles).where(eq(userRoles.userId, "delete-subject")),
    ).toHaveLength(0);
    // device_tokens → deleted (FK cascade on user delete).
    expect(
      await db.select().from(deviceTokens).where(eq(deviceTokens.userId, "delete-subject")),
    ).toHaveLength(0);

    // patient_profiles → anonymized in place, id preserved (referential integrity).
    const [prof] = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.id, subject.profileId));
    expect(prof).toBeDefined();
    expect(prof!.userId).toBeNull();
    expect(prof!.fullName).toBe("");
    expect(prof!.email).toBeNull();
    expect(prof!.dateOfBirth).toBeNull();
    expect(prof!.gender).toBeNull();
    expect(prof!.normalizedPhone).not.toBe(subjectPhone);
    expect(prof!.normalizedPhone.startsWith("deleted:")).toBe(true);

    // appointments → kept (pseudonymous once profile anonymized).
    expect(
      await db.select().from(appointments).where(eq(appointments.id, subject.appointmentId)),
    ).toHaveLength(1);

    // encounters / visit_notes / prescriptions / clinical_access_log → never deleted.
    const [enc] = await db.select().from(encounters).where(eq(encounters.id, subject.encounterId));
    expect(enc).toBeDefined();
    expect(
      await db.select().from(visitNotes).where(eq(visitNotes.encounterId, subject.encounterId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(prescriptions)
        .where(eq(prescriptions.encounterId, subject.encounterId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(clinicalAccessLog)
        .where(eq(clinicalAccessLog.encounterId, subject.encounterId)),
    ).toHaveLength(clinicalLogBefore);

    // notification_log → hard-deleted for the subject (async, via the
    // id-only account_deleted event → communication subscriber).
    await waitFor(async () => {
      const rows = await db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.patientProfileId, subject.profileId));
      const userRows = await db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.userId, "delete-subject"));
      return rows.length === 0 && userRows.length === 0 ? true : undefined;
    });

    // domain_events → kept (pseudonymous); the emitted account_deleted row
    // is id-only (userId + profile ids, no contact PII). v2 since the F-02
    // close-out (ADR-0038); a patient deletion carries no provider id.
    const events = await db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, "delete-subject"));
    const deleted = events.find((e) => e.name === "identity.account_deleted.v2");
    expect(deleted).toBeDefined();
    expect(deleted!.payload).toEqual({
      userId: "delete-subject",
      patientProfileId: subject.profileId,
      providerProfileId: null,
    });

    // send_rate_events / abuse_alerts → phone-keyed kernel rows: the
    // self-service flow does NOT touch them (see ADR-0033). send_rate_events
    // is erased by its own 7-day retention window; abuse_alerts are retained
    // as anti-abuse security records. Asserted here to pin that behavior.
    expect(
      await db.select().from(sendRateEvents).where(eq(sendRateEvents.key, subjectPhone)),
    ).toHaveLength(1);
    expect(
      await db.select().from(abuseAlerts).where(eq(abuseAlerts.key, subjectPhone)),
    ).toHaveLength(1);

    // Self-only: the control account is entirely untouched.
    expect(await db.select().from(user).where(eq(user.id, "delete-control"))).toHaveLength(1);
    expect(
      await db.select().from(deviceTokens).where(eq(deviceTokens.userId, "delete-control")),
    ).toHaveLength(1);
    const [controlProf] = await db
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.id, control.profileId));
    expect(controlProf!.userId).toBe("delete-control");
    expect(controlProf!.fullName).toBe("Name delete-control");
    expect(
      await db.select().from(notificationLog).where(eq(notificationLog.userId, "delete-control")),
    ).toHaveLength(1);
  });

  it("retires an approved provider's public listing on self-deletion (F-02 close-out, ADR-0038)", async () => {
    const { db } = app.kernel;
    const userId = "delete-doctor";
    await db.insert(user).values({
      id: userId,
      name: "Dr Delete",
      email: `${userId}@test.mesomed.example`,
      emailVerified: true,
    });
    await db.insert(userRoles).values({ userId, role: "doctor" });
    const [identityProfile] = await db
      .insert(providerProfiles)
      .values({ userId, providerType: "doctor", status: "approved", phone: "+9647701110003" })
      .returning({ id: providerProfiles.id });
    const [provider] = await db
      .insert(providers)
      .values({ providerType: "doctor", identityProfileId: identityProfile!.id, approved: true })
      .returning({ id: providers.id });
    const [doctor] = await db
      .insert(doctorProfiles)
      .values({
        providerId: provider!.id,
        slug: "delete-doctor",
        nameEn: "Dr Delete",
        nameAr: "Dr Delete",
        nameCkb: "Dr Delete",
        specialtyKey: "cardiology",
        publiclyVisible: true,
      })
      .returning({ id: doctorProfiles.id });

    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.deleteAccount",
      headers: {
        "content-type": "application/json",
        "x-test-roles": "doctor",
        "x-test-user": userId,
      },
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    // The event carries the provider profile id (id-only).
    const events = await db.select().from(domainEvents).where(eq(domainEvents.aggregateId, userId));
    const deleted = events.find((e) => e.name === "identity.account_deleted.v2");
    expect(deleted).toBeDefined();
    expect(deleted!.payload).toEqual({
      userId,
      patientProfileId: null,
      providerProfileId: identityProfile!.id,
    });

    // provider_profiles → cascaded away with the Better Auth user.
    expect(
      await db.select().from(providerProfiles).where(eq(providerProfiles.id, identityProfile!.id)),
    ).toHaveLength(0);

    // Directory listing → retired by the subscriber (async via outbox):
    // approved mirror off, public visibility off — no dangling bookable
    // listing without an account behind it.
    await waitFor(async () => {
      const [p] = await db.select().from(providers).where(eq(providers.id, provider!.id));
      const [d] = await db.select().from(doctorProfiles).where(eq(doctorProfiles.id, doctor!.id));
      return p?.approved === false && d?.publiclyVisible === false ? true : undefined;
    });
  });

  it("rejects an unauthenticated caller (self-only, no cross-user id parameter)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/trpc/identity.deleteAccount",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});
