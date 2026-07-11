import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockOtpChannel } from "@mesomed/platform";
import { placeholderEmailForPhone } from "@mesomed/domain/identity";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  CHANNEL_KILL_SWITCH_CONFIG_KEY,
  channelKillSwitchSchema,
  SEND_RATE_POLICY_CONFIG_KEY,
  sendRatePolicySchema,
} from "@mesomed/config";
import { buildServer } from "../../src/app.js";
import {
  OTP_SEND_POLICY_CONFIG_KEY,
  otpSendPolicySchema,
} from "../../src/modules/identity/otp-sender.js";
import { testEnv } from "../helpers.js";

const PASSWORD = "correct horse battery";

async function signUp(app: FastifyInstance, phone: string): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: {
      name: "OTP Test",
      email: placeholderEmailForPhone(phone),
      password: PASSWORD,
      phoneNumber: phone,
    },
  });
  expect(res.statusCode).toBe(200);
}

describe("OTP logic against the mock channels (MM-DEC rev02 §8)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  const whatsapp = createMockOtpChannel("whatsapp");
  const sms = createMockOtpChannel("sms");

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString), {
      otpChannels: { whatsapp, sms },
      otpOptions: { expiresInSeconds: 1, allowedVerifyAttempts: 2 },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("issues a 6-digit code over WhatsApp first", async () => {
    const phone = "+9647702000001";
    await signUp(app, phone);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: phone },
    });
    expect(res.statusCode).toBe(200);
    expect(whatsapp.sent.at(-1)?.code).toMatch(/^\d{6}$/);
    expect(sms.sent).toHaveLength(0);
  });

  it("rejects a wrong code and enforces the verify-attempt limit", async () => {
    const phone = "+9647702000002";
    await signUp(app, phone);
    await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: phone },
    });
    const code = whatsapp.sent.at(-1)?.code;
    const wrong = code === "000000" ? "000001" : "000000";

    const attempt1 = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/verify",
      payload: { phoneNumber: phone, code: wrong },
    });
    expect(attempt1.statusCode).toBe(400);
    const attempt2 = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/verify",
      payload: { phoneNumber: phone, code: wrong },
    });
    expect([400, 403]).toContain(attempt2.statusCode);

    // Attempt limit (2) consumed — even the CORRECT code is now rejected.
    const withCorrect = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/verify",
      payload: { phoneNumber: phone, code },
    });
    expect(withCorrect.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("rejects an expired code", async () => {
    const phone = "+9647702000003";
    await signUp(app, phone);
    await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: phone },
    });
    const code = whatsapp.sent.at(-1)?.code;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const verify = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/verify",
      payload: { phoneNumber: phone, code },
    });
    expect(verify.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("enforces the per-phone send rate limit and records nothing when blocked", async () => {
    const phone = "+9647702000004";
    await signUp(app, phone);
    await app.kernel.config.set(otpSendPolicySchema, OTP_SEND_POLICY_CONFIG_KEY, {
      maxSends: 2,
      windowSeconds: 3600,
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: phone },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: phone },
    });
    expect(second.statusCode).toBe(200);

    const deliveredBefore = whatsapp.sent.length + sms.sent.length;
    const third = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      payload: { phoneNumber: phone },
    });
    expect(third.statusCode).toBe(429);
    expect(third.json().code).toBe("RATE_LIMITED");
    // Meta-test: the guardrail fires BEFORE any delivery happens.
    expect(whatsapp.sent.length + sms.sent.length).toBe(deliveredBefore);

    await app.kernel.config.set(otpSendPolicySchema, OTP_SEND_POLICY_CONFIG_KEY, {
      maxSends: 100,
      windowSeconds: 3600,
    });
  });

  it("falls back to SMS when WhatsApp delivery fails", async () => {
    const phone = "+9647702000005";
    await signUp(app, phone);
    whatsapp.failing = true;
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/phone-number/send-otp",
        payload: { phoneNumber: phone },
      });
      expect(res.statusCode).toBe(200);
      expect(sms.sent.at(-1)?.to).toBe(phone);
      expect(sms.sent.at(-1)?.code).toMatch(/^\d{6}$/);

      // The SMS-delivered code is fully usable.
      const verify = await app.inject({
        method: "POST",
        url: "/api/auth/phone-number/verify",
        payload: { phoneNumber: phone, code: sms.sent.at(-1)?.code },
      });
      expect(verify.statusCode).toBe(200);
    } finally {
      whatsapp.failing = false;
    }
  });

  it("answers 502 OTP_DELIVERY_FAILED when both channels fail", async () => {
    const phone = "+9647702000006";
    await signUp(app, phone);
    whatsapp.failing = true;
    sms.failing = true;
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/phone-number/send-otp",
        payload: { phoneNumber: phone },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("OTP_DELIVERY_FAILED");
    } finally {
      whatsapp.failing = false;
      sms.failing = false;
    }
  });

  describe("kernel abuse guardrails wired into OTP send (MM-ARC-002 §6.6)", () => {
    it("falls back to SMS when the whatsapp channel is killed", async () => {
      const phone = "+9647702000007";
      await signUp(app, phone);
      await app.kernel.config.set(channelKillSwitchSchema, CHANNEL_KILL_SWITCH_CONFIG_KEY, {
        whatsapp: true,
      });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/phone-number/send-otp",
          payload: { phoneNumber: phone },
        });
        expect(res.statusCode).toBe(200);
        expect(sms.sent.at(-1)?.to).toBe(phone);
        // The killed channel is never attempted, so no failure is recorded on it.
        expect(whatsapp.sent.some((m) => m.to === phone)).toBe(false);
      } finally {
        await app.kernel.config.set(channelKillSwitchSchema, CHANNEL_KILL_SWITCH_CONFIG_KEY, {});
      }
    });

    it("answers a typed refusal when both channels are killed", async () => {
      const phone = "+9647702000008";
      await signUp(app, phone);
      await app.kernel.config.set(channelKillSwitchSchema, CHANNEL_KILL_SWITCH_CONFIG_KEY, {
        whatsapp: true,
        sms: true,
      });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/phone-number/send-otp",
          payload: { phoneNumber: phone },
        });
        expect(res.statusCode).toBe(502);
        expect(res.json().code).toBe("OTP_DELIVERY_FAILED");
        expect(whatsapp.sent.some((m) => m.to === phone)).toBe(false);
        expect(sms.sent.some((m) => m.to === phone)).toBe(false);
      } finally {
        await app.kernel.config.set(channelKillSwitchSchema, CHANNEL_KILL_SWITCH_CONFIG_KEY, {});
      }
    });

    it("denies a destination outside the allowlisted country (Iraq-only launch seed)", async () => {
      const phone = "+14155550009";
      await signUp(app, phone);
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/phone-number/send-otp",
        payload: { phoneNumber: phone },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("OTP_DELIVERY_FAILED");
      expect(whatsapp.sent.some((m) => m.to === phone)).toBe(false);
      expect(sms.sent.some((m) => m.to === phone)).toBe(false);
    });

    it("fires the per-IP send-rate limit across distinct phone numbers", async () => {
      const ip = "203.0.113.9";
      await app.kernel.config.set(sendRatePolicySchema, SEND_RATE_POLICY_CONFIG_KEY, {
        ip: { maxSends: 2, windowSeconds: 3600 },
      });
      try {
        const phones = ["+9647702000010", "+9647702000011", "+9647702000012"];
        for (const phone of phones) await signUp(app, phone);

        const first = await app.inject({
          method: "POST",
          url: "/api/auth/phone-number/send-otp",
          payload: { phoneNumber: phones[0] },
          headers: { "x-forwarded-for": ip },
        });
        expect(first.statusCode).toBe(200);

        const second = await app.inject({
          method: "POST",
          url: "/api/auth/phone-number/send-otp",
          payload: { phoneNumber: phones[1] },
          headers: { "x-forwarded-for": ip },
        });
        expect(second.statusCode).toBe(200);

        const deliveredBefore = whatsapp.sent.length + sms.sent.length;
        const third = await app.inject({
          method: "POST",
          url: "/api/auth/phone-number/send-otp",
          payload: { phoneNumber: phones[2] },
          headers: { "x-forwarded-for": ip },
        });
        expect(third.statusCode).toBe(429);
        expect(third.json().code).toBe("RATE_LIMITED");
        expect(whatsapp.sent.length + sms.sent.length).toBe(deliveredBefore);
      } finally {
        await app.kernel.config.set(sendRatePolicySchema, SEND_RATE_POLICY_CONFIG_KEY, {});
      }
    });

    it("fires the per-device send-rate limit across distinct phone numbers", async () => {
      const deviceId = "test-device-1";
      await app.kernel.config.set(sendRatePolicySchema, SEND_RATE_POLICY_CONFIG_KEY, {
        device: { maxSends: 2, windowSeconds: 3600 },
      });
      try {
        const phones = ["+9647702000013", "+9647702000014", "+9647702000015"];
        for (const phone of phones) await signUp(app, phone);

        const first = await app.inject({
          method: "POST",
          url: "/api/auth/phone-number/send-otp",
          payload: { phoneNumber: phones[0] },
          headers: { "x-device-id": deviceId },
        });
        expect(first.statusCode).toBe(200);

        const second = await app.inject({
          method: "POST",
          url: "/api/auth/phone-number/send-otp",
          payload: { phoneNumber: phones[1] },
          headers: { "x-device-id": deviceId },
        });
        expect(second.statusCode).toBe(200);

        const deliveredBefore = whatsapp.sent.length + sms.sent.length;
        const third = await app.inject({
          method: "POST",
          url: "/api/auth/phone-number/send-otp",
          payload: { phoneNumber: phones[2] },
          headers: { "x-device-id": deviceId },
        });
        expect(third.statusCode).toBe(429);
        expect(third.json().code).toBe("RATE_LIMITED");
        expect(whatsapp.sent.length + sms.sent.length).toBe(deliveredBefore);
      } finally {
        await app.kernel.config.set(sendRatePolicySchema, SEND_RATE_POLICY_CONFIG_KEY, {});
      }
    });
  });
});
