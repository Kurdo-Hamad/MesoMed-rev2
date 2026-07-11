import { describe, expect, it } from "vitest";
import { evaluateCancellationPolicy, type CancellationPolicy } from "./cancellation-policy.js";

const policy: CancellationPolicy = {
  enabled: true,
  freeCancellationWindowHours: 24,
  cancellationFeeMinor: 5_000_000,
  noShowFeeMinor: 10_000_000,
};

const startsAt = new Date("2026-06-10T09:00:00.000Z");

describe("evaluateCancellationPolicy", () => {
  it("a disabled policy never yields a fee", () => {
    expect(
      evaluateCancellationPolicy({
        policy: { ...policy, enabled: false },
        trigger: "no_show",
        startsAt,
        occurredAt: startsAt,
      }),
    ).toEqual({ outcome: "policy_disabled", feeMinor: 0 });
  });

  it("cancelling at or before the free window boundary is free", () => {
    // Exactly 24h before start — boundary is free.
    expect(
      evaluateCancellationPolicy({
        policy,
        trigger: "cancellation",
        startsAt,
        occurredAt: new Date("2026-06-09T09:00:00.000Z"),
      }),
    ).toEqual({ outcome: "within_free_window", feeMinor: 0 });
  });

  it("cancelling inside the window bears the cancellation fee", () => {
    expect(
      evaluateCancellationPolicy({
        policy,
        trigger: "cancellation",
        startsAt,
        occurredAt: new Date("2026-06-09T09:00:00.001Z"),
      }),
    ).toEqual({ outcome: "fee_applicable", feeMinor: 5_000_000 });
    // Cancelling after the start instant is also inside the window.
    expect(
      evaluateCancellationPolicy({
        policy,
        trigger: "cancellation",
        startsAt,
        occurredAt: new Date("2026-06-10T10:00:00.000Z"),
      }).outcome,
    ).toBe("fee_applicable");
  });

  it("a zero fee evaluates as fee_zero, never as a zero-amount charge", () => {
    expect(
      evaluateCancellationPolicy({
        policy: { ...policy, cancellationFeeMinor: 0 },
        trigger: "cancellation",
        startsAt,
        occurredAt: startsAt,
      }),
    ).toEqual({ outcome: "fee_zero", feeMinor: 0 });
    expect(
      evaluateCancellationPolicy({
        policy: { ...policy, noShowFeeMinor: 0 },
        trigger: "no_show",
        startsAt,
        occurredAt: startsAt,
      }),
    ).toEqual({ outcome: "fee_zero", feeMinor: 0 });
  });

  it("no-show always bears the no-show fee regardless of timing", () => {
    expect(
      evaluateCancellationPolicy({
        policy,
        trigger: "no_show",
        startsAt,
        occurredAt: new Date("2026-06-12T00:00:00.000Z"),
      }),
    ).toEqual({ outcome: "fee_applicable", feeMinor: 10_000_000 });
  });

  it("a zero-hour window makes only post-start cancellation chargeable", () => {
    const zeroWindow = { ...policy, freeCancellationWindowHours: 0 };
    expect(
      evaluateCancellationPolicy({
        policy: zeroWindow,
        trigger: "cancellation",
        startsAt,
        occurredAt: startsAt,
      }).outcome,
    ).toBe("within_free_window");
    expect(
      evaluateCancellationPolicy({
        policy: zeroWindow,
        trigger: "cancellation",
        startsAt,
        occurredAt: new Date(startsAt.getTime() + 1),
      }).outcome,
    ).toBe("fee_applicable");
  });

  it("rejects invalid windows", () => {
    expect(() =>
      evaluateCancellationPolicy({
        policy: { ...policy, freeCancellationWindowHours: -1 },
        trigger: "cancellation",
        startsAt,
        occurredAt: startsAt,
      }),
    ).toThrow();
  });
});
