import { describe, expect, it } from "vitest";
import { createMockAiGateway } from "./ai-mock.js";
import { createMockEmailChannel } from "./email-mock.js";
import { isMockAdapter } from "./mock-flag.js";
import { createMockNotifyChannel } from "./notify-mock.js";
import { createMockOtpChannel } from "./otp-mock.js";
import { createMockPushChannel } from "./push-mock.js";

describe("isMockAdapter", () => {
  it("recognizes every mock adapter in this package", () => {
    expect(isMockAdapter(createMockOtpChannel("whatsapp"))).toBe(true);
    expect(isMockAdapter(createMockEmailChannel())).toBe(true);
    expect(isMockAdapter(createMockNotifyChannel("sms"))).toBe(true);
    expect(isMockAdapter(createMockPushChannel())).toBe(true);
    expect(isMockAdapter(createMockAiGateway())).toBe(true);
  });

  it("returns false for non-mock values", () => {
    expect(isMockAdapter({})).toBe(false);
    expect(isMockAdapter(null)).toBe(false);
    expect(isMockAdapter(undefined)).toBe(false);
    expect(isMockAdapter("mock")).toBe(false);
  });
});
