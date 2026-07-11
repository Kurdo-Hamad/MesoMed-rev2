import { describe, expect, it, vi } from "vitest";
import { EmailSendError } from "./email.js";
import { createResendEmailAdapter } from "./email-resend.js";

function response(ok: boolean, status = 200): Response {
  return { ok, status } as Response;
}

describe("createResendEmailAdapter", () => {
  it("posts to the Resend emails endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(true));
    const adapter = createResendEmailAdapter({
      apiKey: "re_secret",
      from: "no-reply@mesomed.example",
      fetchImpl,
    });

    await adapter.send({ to: "patient@example.com", subject: "Hi", text: "Body" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("/emails");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_secret");
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload).toMatchObject({
      from: "no-reply@mesomed.example",
      to: ["patient@example.com"],
      subject: "Hi",
      text: "Body",
    });
  });

  it("wraps a non-ok response as EmailSendError without leaking the API key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(false, 422));
    const adapter = createResendEmailAdapter({
      apiKey: "re_super_secret",
      from: "no-reply@mesomed.example",
      fetchImpl,
    });

    let rejection: Error | undefined;
    try {
      await adapter.send({ to: "patient@example.com", subject: "Hi", text: "Body" });
    } catch (e) {
      rejection = e as Error;
    }
    expect(rejection).toBeInstanceOf(EmailSendError);
    expect(rejection?.message).not.toContain("re_super_secret");
  });

  it("wraps a network failure as EmailSendError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const adapter = createResendEmailAdapter({
      apiKey: "re_secret",
      from: "no-reply@mesomed.example",
      fetchImpl,
    });

    await expect(
      adapter.send({ to: "patient@example.com", subject: "Hi", text: "Body" }),
    ).rejects.toBeInstanceOf(EmailSendError);
  });
});
