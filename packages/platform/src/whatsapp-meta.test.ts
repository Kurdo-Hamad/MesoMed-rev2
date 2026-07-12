import { describe, expect, it, vi } from "vitest";
import { NotifySendError } from "./notify.js";
import { OtpSendError } from "./otp.js";
import { createMetaWhatsAppAdapter } from "./whatsapp-meta.js";

const OTP_CATALOG = {
  en: "Your MesoMed verification code is {code}. It expires in {minutes} minutes.",
  ckb: "کۆدی {code} بۆ {minutes}.",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("createMetaWhatsAppAdapter", () => {
  it("sends a notify message via the Meta Graph API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const adapter = createMetaWhatsAppAdapter(
      { accessToken: "tok", phoneNumberId: "123", fetchImpl },
      OTP_CATALOG,
    );

    await adapter.notify.send({ to: "+9647701234567", body: "hello" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("/123/messages");
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload).toMatchObject({ to: "+9647701234567", type: "text", text: { body: "hello" } });
  });

  it("wraps a non-ok response as NotifySendError without leaking the token or the destination (ADR-0011 F-6)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const adapter = createMetaWhatsAppAdapter(
      { accessToken: "super-secret-token", phoneNumberId: "123", fetchImpl },
      OTP_CATALOG,
    );

    await expect(adapter.notify.send({ to: "+9647701234567", body: "hi" })).rejects.toBeInstanceOf(
      NotifySendError,
    );
    let rejection: Error | undefined;
    try {
      await adapter.notify.send({ to: "+9647701234567", body: "hi" });
    } catch (e) {
      rejection = e as Error;
    }
    expect(rejection?.cause).toBeDefined();
    expect(String(rejection?.cause)).not.toContain("super-secret-token");
    expect(rejection?.message).not.toContain("+9647701234567");
    expect(String(rejection?.cause)).not.toContain("+9647701234567");
  });

  it("renders the OTP message from the locale catalog", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const adapter = createMetaWhatsAppAdapter(
      { accessToken: "tok", phoneNumberId: "123", fetchImpl },
      OTP_CATALOG,
    );

    await adapter.otp.send({ to: "+9647701234567", code: "482913", locale: "en", expiresInMinutes: 5 });

    const [, init] = fetchImpl.mock.calls[0]!;
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.text.body).toContain("482913");
  });

  it("renders the message's actual expiresInMinutes, not a hardcoded figure (ADR-0011 F-13)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const adapter = createMetaWhatsAppAdapter(
      { accessToken: "tok", phoneNumberId: "123", fetchImpl },
      OTP_CATALOG,
    );

    await adapter.otp.send({ to: "+9647701234567", code: "482913", locale: "en", expiresInMinutes: 5 });

    const [, init] = fetchImpl.mock.calls[0]!;
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.text.body).toContain("expires in 5 minutes");
    expect(payload.text.body).not.toContain("10 minutes");
  });

  it("aborts a stalled request after timeoutMs instead of hanging (ADR-0011 F-3)", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const adapter = createMetaWhatsAppAdapter(
      { accessToken: "tok", phoneNumberId: "123", fetchImpl, timeoutMs: 20 },
      OTP_CATALOG,
    );

    await expect(adapter.notify.send({ to: "+9647701234567", body: "hi" })).rejects.toBeInstanceOf(
      NotifySendError,
    );
  });

  it("wraps OTP delivery failure as OtpSendError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const adapter = createMetaWhatsAppAdapter(
      { accessToken: "tok", phoneNumberId: "123", fetchImpl },
      OTP_CATALOG,
    );

    await expect(
      adapter.otp.send({ to: "+9647701234567", code: "482913", locale: "en", expiresInMinutes: 5 }),
    ).rejects.toBeInstanceOf(OtpSendError);
  });
});
