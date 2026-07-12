import { describe, expect, it, vi } from "vitest";
import { PushSendError, PushTokenInvalidError } from "./push.js";
import { createExpoPushAdapter } from "./push-expo.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe("createExpoPushAdapter", () => {
  it("posts to the Expo push API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { status: "ok" } }));
    const adapter = createExpoPushAdapter({ fetchImpl });

    await adapter.send({ token: "ExponentPushToken[abc]", title: "Hi", body: "There" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("exp.host");
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload).toMatchObject({ to: "ExponentPushToken[abc]", title: "Hi", body: "There" });
  });

  it("maps DeviceNotRegistered to PushTokenInvalidError without leaking the token itself (ADR-0011 F-6)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { status: "error", message: "dead", details: { error: "DeviceNotRegistered" } },
      }),
    );
    const adapter = createExpoPushAdapter({ fetchImpl });

    let rejection: Error | undefined;
    try {
      await adapter.send({ token: "ExponentPushToken[dead]", title: "Hi", body: "There" });
    } catch (e) {
      rejection = e as Error;
    }
    expect(rejection).toBeInstanceOf(PushTokenInvalidError);
    expect(rejection?.message).not.toContain("ExponentPushToken[dead]");
  });

  it("maps other ticket errors to PushSendError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { status: "error", message: "rate limited" } }));
    const adapter = createExpoPushAdapter({ fetchImpl });

    await expect(
      adapter.send({ token: "ExponentPushToken[abc]", title: "Hi", body: "There" }),
    ).rejects.toBeInstanceOf(PushSendError);
  });

  it("wraps a non-ok HTTP response as PushSendError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const adapter = createExpoPushAdapter({ fetchImpl });

    await expect(
      adapter.send({ token: "ExponentPushToken[abc]", title: "Hi", body: "There" }),
    ).rejects.toBeInstanceOf(PushSendError);
  });

  it("aborts a stalled request after timeoutMs instead of hanging (ADR-0011 F-3)", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const adapter = createExpoPushAdapter({ fetchImpl, timeoutMs: 20 });

    await expect(
      adapter.send({ token: "ExponentPushToken[abc]", title: "Hi", body: "There" }),
    ).rejects.toBeInstanceOf(PushSendError);
  });
});
