import { describe, expect, it } from "vitest";

import { evaluateOtpSendLimit } from "./otp-rate-limit.js";

const policy = { maxSends: 3, windowSeconds: 3600 };
const now = new Date("2026-07-10T12:00:00Z");

const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("evaluateOtpSendLimit", () => {
  it("allows the first send", () => {
    expect(evaluateOtpSendLimit([], now, policy)).toEqual({ allowed: true });
  });

  it("allows sends while under the window limit", () => {
    expect(evaluateOtpSendLimit([minutesAgo(10), minutesAgo(5)], now, policy)).toEqual({
      allowed: true,
    });
  });

  it("blocks the send that would exceed the limit and reports retry-after", () => {
    const result = evaluateOtpSendLimit([minutesAgo(50), minutesAgo(30), minutesAgo(10)], now, policy);
    // The oldest send (50 min ago) leaves the 60-min window in 10 minutes.
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 600 });
  });

  it("ignores sends that have left the window", () => {
    expect(
      evaluateOtpSendLimit([minutesAgo(120), minutesAgo(90), minutesAgo(61)], now, policy),
    ).toEqual({ allowed: true });
  });

  it("counts a send exactly at the window boundary as expired", () => {
    expect(
      evaluateOtpSendLimit([minutesAgo(60), minutesAgo(30), minutesAgo(10)], now, policy),
    ).toEqual({ allowed: true });
  });
});
