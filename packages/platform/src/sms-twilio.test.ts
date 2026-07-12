import { describe, expect, it, vi } from "vitest";
import { NotifySendError } from "./notify.js";
import { OtpSendError } from "./otp.js";
import { createTwilioSmsAdapter } from "./sms-twilio.js";

const OTP_CATALOG = {
  en: "Your code is {code}. It expires in {minutes} minutes.",
  ckb: "کۆد {code} بۆ {minutes}.",
};

function response(ok: boolean, status = 200): Response {
  return { ok, status } as Response;
}

describe("createTwilioSmsAdapter", () => {
  it("posts to the Twilio Messages endpoint with basic auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(true));
    const adapter = createTwilioSmsAdapter(
      { accountSid: "AC123", authToken: "secret", from: "+15005550006", fetchImpl },
      OTP_CATALOG,
    );

    await adapter.notify.send({ to: "+9647701234567", body: "hi" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("/Accounts/AC123/Messages.json");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get("To")).toBe("+9647701234567");
    expect(body.get("Body")).toBe("hi");
  });

  it("wraps a non-ok response as NotifySendError without leaking the auth token or the destination (ADR-0011 F-6)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(false, 401));
    const adapter = createTwilioSmsAdapter(
      { accountSid: "AC123", authToken: "super-secret", from: "+15005550006", fetchImpl },
      OTP_CATALOG,
    );

    let rejection: Error | undefined;
    try {
      await adapter.notify.send({ to: "+9647701234567", body: "hi" });
    } catch (e) {
      rejection = e as Error;
    }
    expect(rejection).toBeInstanceOf(NotifySendError);
    expect(String(rejection?.cause)).not.toContain("super-secret");
    expect(rejection?.message).not.toContain("+9647701234567");
    expect(String(rejection?.cause)).not.toContain("+9647701234567");
  });

  it("wraps OTP delivery failure as OtpSendError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(false, 500));
    const adapter = createTwilioSmsAdapter(
      { accountSid: "AC123", authToken: "secret", from: "+15005550006", fetchImpl },
      OTP_CATALOG,
    );

    await expect(
      adapter.otp.send({ to: "+9647701234567", code: "111222", locale: "en", expiresInMinutes: 5 }),
    ).rejects.toBeInstanceOf(OtpSendError);
  });

  it("renders the message's actual expiresInMinutes, not a hardcoded figure (ADR-0011 F-13)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(true));
    const adapter = createTwilioSmsAdapter(
      { accountSid: "AC123", authToken: "secret", from: "+15005550006", fetchImpl },
      OTP_CATALOG,
    );

    await adapter.otp.send({ to: "+9647701234567", code: "111222", locale: "en", expiresInMinutes: 5 });

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get("Body")).toContain("expires in 5 minutes");
    expect(body.get("Body")).not.toContain("10 minutes");
  });

  it("aborts a stalled request after timeoutMs instead of hanging (ADR-0011 F-3)", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const adapter = createTwilioSmsAdapter(
      { accountSid: "AC123", authToken: "secret", from: "+15005550006", fetchImpl, timeoutMs: 20 },
      OTP_CATALOG,
    );

    await expect(adapter.notify.send({ to: "+9647701234567", body: "hi" })).rejects.toBeInstanceOf(
      NotifySendError,
    );
  });
});
