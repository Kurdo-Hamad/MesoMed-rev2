import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockOtpChannel } from "@mesomed/platform";
import { placeholderEmailForPhone } from "@mesomed/domain/identity";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "@mesomed/api/app";
import { loadEnv } from "@mesomed/api/env";
import { createMobileAuthClient, type AuthClientStorage } from "../lib/create-auth-client.js";

const PHONE = "+9647709000001";
const PASSWORD = "correct horse battery";

/** In-memory SecureStore double: same sync surface expo-secure-store exposes. */
function memoryStorage(): AuthClientStorage & { dump(): Record<string, string> } {
  const store = new Map<string, string>();
  return {
    setItem: (key, value) => {
      store.set(key, value);
    },
    getItem: (key) => store.get(key) ?? null,
    dump: () => Object.fromEntries(store),
  };
}

/**
 * Phase 2 gate: mobile session persistence via the Better Auth Expo
 * plugin + secure store. Runs the REAL client plugin against a live API
 * instance over HTTP; a second client sharing the same storage simulates
 * an app relaunch. On-device verification (Maestro) lands in Phase 9.
 */
describe("mobile session persistence (Better Auth Expo plugin + secure store)", () => {
  let tdb: TestDatabase;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseURL = "";
  const whatsapp = createMockOtpChannel("whatsapp");
  const sms = createMockOtpChannel("sms");

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

    // Register + verify a patient over the raw HTTP API.
    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Mobile Patient",
        email: placeholderEmailForPhone(PHONE),
        password: PASSWORD,
        phoneNumber: PHONE,
      }),
    });
    expect(signup.status).toBe(200);
    await fetch(`${baseURL}/api/auth/phone-number/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: PHONE }),
    });
    const verify = await fetch(`${baseURL}/api/auth/phone-number/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: PHONE, code: whatsapp.sent.at(-1)?.code }),
    });
    expect(verify.status).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("stores the session in secure storage on sign-in and reuses it after an app relaunch", async () => {
    const storage = memoryStorage();
    const client = createMobileAuthClient({ baseURL, storage });

    const signIn = await client.signIn.phoneNumber({ phoneNumber: PHONE, password: PASSWORD });
    expect(signIn.error).toBeNull();

    // The Expo plugin persisted the session cookie into the secure store.
    const stored = storage.dump();
    const cookieEntry = Object.entries(stored).find(([key]) => key.startsWith("mesomed"));
    expect(cookieEntry).toBeTruthy();
    expect(JSON.stringify(stored)).toContain("session_token");

    const session = await client.getSession();
    expect(session.data?.user).toBeTruthy();

    // "Relaunch": a brand-new client instance over the SAME storage must
    // still be signed in without re-authenticating.
    const relaunched = createMobileAuthClient({ baseURL, storage });
    const restored = await relaunched.getSession();
    expect(restored.data?.user.phoneNumber).toBe(PHONE);
  });

  it("clears the stored session on sign-out", async () => {
    const storage = memoryStorage();
    const client = createMobileAuthClient({ baseURL, storage });
    await client.signIn.phoneNumber({ phoneNumber: PHONE, password: PASSWORD });
    expect(JSON.stringify(storage.dump())).toContain("session_token");

    await client.signOut();

    const relaunched = createMobileAuthClient({ baseURL, storage });
    const session = await relaunched.getSession();
    expect(session.data).toBeNull();
  });
});
