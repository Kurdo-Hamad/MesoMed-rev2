import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { user } from "@mesomed/db";
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
});
