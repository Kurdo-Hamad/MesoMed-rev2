import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../src/app.js";
import { testEnv } from "./helpers.js";

/**
 * Mock→real production guardrail (MM-PLAN-001 §5 Phase 7 Task 8): a mock
 * adapter silently "delivering" in production is a worse failure mode than
 * a boot failure. `buildServer` must refuse to start when NODE_ENV is
 * production and ANY channel still resolves to its mock — and must boot
 * cleanly past the guard once every channel's real credentials are present.
 */
describe("mock-production guardrail", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  }, 60_000);

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  afterAll(async () => {
    // Missing since Phase 7: without this, the embedded server was killed
    // by the library's process-exit hook but its temp dir leaked on every
    // local run (found while closing the ADR-0021 leak check).
    await tdb?.close();
  });

  it("refuses to boot in production when credentials are missing, naming the mock adapter", async () => {
    const prodEnv = testEnv(tdb.connectionString, { NODE_ENV: "production" });

    await expect(buildServer(prodEnv)).rejects.toThrow(/mock adapter wired/i);
  });

  it("boots past the guard once every channel has (fake) real credentials", async () => {
    const prodEnv = testEnv(tdb.connectionString, {
      NODE_ENV: "production",
      WHATSAPP_ACCESS_TOKEN: "fake-whatsapp-token",
      WHATSAPP_PHONE_NUMBER_ID: "fake-phone-number-id",
      TWILIO_ACCOUNT_SID: "fake-account-sid",
      TWILIO_AUTH_TOKEN: "fake-auth-token",
      TWILIO_FROM: "+10000000000",
      RESEND_API_KEY: "fake-resend-key",
      RESEND_FROM: "noreply@example.test",
      EXPO_PUSH_ACCESS_TOKEN: "fake-expo-token",
      ANTHROPIC_API_KEY: "fake-anthropic-key",
    });

    app = await buildServer(prodEnv);
    await app.ready();

    expect(app).toBeDefined();
  });
});
