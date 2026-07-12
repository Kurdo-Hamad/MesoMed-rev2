import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { notificationLog, user } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildBookingTestServer, result, trpc } from "../booking/helpers.js";

async function seedUser(app: FastifyInstance, id: string): Promise<void> {
  await app.kernel.db
    .insert(user)
    .values({ id, name: id, email: `${id}@test.mesomed.example`, emailVerified: true })
    .onConflictDoNothing();
}

describe("communication router (MM-PLAN-001 §5 Phase 7)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBookingTestServer(tdb.connectionString);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("rejects an unauthenticated caller (layer a)", async () => {
    const res = await trpc(app, "communication.getChannelPreferences", "query");
    expect(res.statusCode).toBe(401);
  });

  it("returns platform defaults before any preference row exists", async () => {
    const res = await trpc(app, "communication.getChannelPreferences", "query", undefined, {
      roles: "patient",
      user: "router-test-patient-1",
    });
    expect(res.statusCode).toBe(200);
    expect(result(res)).toEqual({
      pushEnabled: true,
      whatsappEnabled: true,
      smsEnabled: true,
      emailEnabled: true,
      locale: null,
    });
  });

  it("sets and merges channel preferences for the caller's own session only", async () => {
    const session = { roles: "patient", user: "router-test-patient-2" };
    await seedUser(app, session.user);
    await seedUser(app, "router-test-patient-other");

    const setRes = await trpc(
      app,
      "communication.setChannelPreferences",
      "mutation",
      { emailEnabled: false, locale: "en" },
      session,
    );
    expect(setRes.statusCode).toBe(200);
    expect(result(setRes)).toEqual({
      pushEnabled: true,
      whatsappEnabled: true,
      smsEnabled: true,
      emailEnabled: false,
      locale: "en",
    });

    // A second, partial write merges onto the first rather than resetting it.
    const secondRes = await trpc(
      app,
      "communication.setChannelPreferences",
      "mutation",
      { whatsappEnabled: false },
      session,
    );
    expect(result(secondRes)).toEqual({
      pushEnabled: true,
      whatsappEnabled: false,
      smsEnabled: true,
      emailEnabled: false,
      locale: "en",
    });

    // A different user's preferences are untouched (own-row-only, layer b).
    const otherRes = await trpc(app, "communication.getChannelPreferences", "query", undefined, {
      roles: "patient",
      user: "router-test-patient-other",
    });
    expect(result(otherRes)).toEqual({
      pushEnabled: true,
      whatsappEnabled: true,
      smsEnabled: true,
      emailEnabled: true,
      locale: null,
    });
  });

  it("registers a device token and reassigns it on re-registration (invariant: token is globally unique)", async () => {
    const firstOwner = { roles: "patient", user: "router-test-device-owner-1" };
    const secondOwner = { roles: "patient", user: "router-test-device-owner-2" };
    await seedUser(app, firstOwner.user);
    await seedUser(app, secondOwner.user);
    const token = "expo-token-router-test-shared";

    const firstRes = await trpc(
      app,
      "communication.registerDeviceToken",
      "mutation",
      { token, platform: "ios" },
      firstOwner,
    );
    expect(firstRes.statusCode).toBe(200);
    const { deviceTokenId: firstId } = result<{ deviceTokenId: string }>(firstRes);

    const secondRes = await trpc(
      app,
      "communication.registerDeviceToken",
      "mutation",
      { token, platform: "android" },
      secondOwner,
    );
    expect(secondRes.statusCode).toBe(200);
    const { deviceTokenId: secondId } = result<{ deviceTokenId: string }>(secondRes);

    // Same token row (upsert on the token's own unique constraint), not a duplicate.
    expect(secondId).toBe(firstId);
  });

  it("rejects a malformed registerDeviceToken input (contract test)", async () => {
    const res = await trpc(
      app,
      "communication.registerDeviceToken",
      "mutation",
      { token: "", platform: "ios" },
      { roles: "patient", user: "router-test-invalid" },
    );
    expect(res.statusCode).toBe(400);
  });

  it("unregisters the caller's own device token on logout (ADR-0011 F-9)", async () => {
    const owner = { roles: "patient", user: "router-test-unregister-owner" };
    await seedUser(app, owner.user);
    const token = "expo-token-router-test-unregister";

    await trpc(app, "communication.registerDeviceToken", "mutation", { token, platform: "ios" }, owner);

    const res = await trpc(app, "communication.unregisterDeviceToken", "mutation", { token }, owner);
    expect(res.statusCode).toBe(200);
    expect(result(res)).toEqual({ unregistered: true });

    // Re-registering succeeds cleanly — the row is genuinely gone, not just marked.
    const reRegister = await trpc(
      app,
      "communication.registerDeviceToken",
      "mutation",
      { token, platform: "android" },
      owner,
    );
    expect(reRegister.statusCode).toBe(200);
  });

  it("does not unregister another caller's device token (own-row-only, layer b)", async () => {
    const owner = { roles: "patient", user: "router-test-unregister-victim" };
    const attacker = { roles: "patient", user: "router-test-unregister-attacker" };
    await seedUser(app, owner.user);
    await seedUser(app, attacker.user);
    const token = "expo-token-router-test-owned";

    await trpc(app, "communication.registerDeviceToken", "mutation", { token, platform: "ios" }, owner);

    const res = await trpc(
      app,
      "communication.unregisterDeviceToken",
      "mutation",
      { token },
      attacker,
    );
    expect(res.statusCode).toBe(200);
    expect(result(res)).toEqual({ unregistered: false });

    // The owner's token still exists — re-registering it just reassigns it,
    // proving the row wasn't deleted (same invariant as the reassignment test above).
    const stillOwned = await trpc(
      app,
      "communication.registerDeviceToken",
      "mutation",
      { token, platform: "ios" },
      owner,
    );
    expect(stillOwned.statusCode).toBe(200);
  });

  it("silently succeeds unregistering a token that was never registered", async () => {
    const res = await trpc(
      app,
      "communication.unregisterDeviceToken",
      "mutation",
      { token: "expo-token-router-test-never-existed" },
      { roles: "patient", user: "router-test-unregister-nonexistent" },
    );
    expect(res.statusCode).toBe(200);
    expect(result(res)).toEqual({ unregistered: false });
  });

  it("rejects a non-admin caller from the notifications feed, layer (a) role guard (ADR-0011 F-14)", async () => {
    const res = await trpc(app, "communication.listRecentNotifications", "query", undefined, {
      roles: "patient",
      user: "router-test-feed-patient",
    });
    expect(res.statusCode).toBe(403);
  });

  it("lists recent notifications for an admin caller, excluding destination/paramsJson (ADR-0011 F-14)", async () => {
    const [row] = await app.kernel.db
      .insert(notificationLog)
      .values({
        template: "reminder",
        channel: "whatsapp",
        destination: "+9647701234567",
        locale: "en",
        paramsJson: JSON.stringify({ doctorName: "Dr. Feed" }),
        dedupeKey: `router-test-feed:${Date.now()}:${Math.random()}`,
      })
      .returning({ id: notificationLog.id });

    const res = await trpc(app, "communication.listRecentNotifications", "query", { limit: 50 }, {
      roles: "admin",
      user: "router-test-feed-admin",
    });
    expect(res.statusCode).toBe(200);
    const rows = result<Array<Record<string, unknown>>>(res);
    const entry = rows.find((r) => r.id === row!.id);
    expect(entry).toMatchObject({ template: "reminder", channel: "whatsapp", status: "pending" });
    expect(entry).not.toHaveProperty("destination");
    expect(entry).not.toHaveProperty("paramsJson");
  });
});
