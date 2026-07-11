import { describe, expect, it } from "vitest";
import { paymentPeriod } from "./payment-period.js";
import { computeNewExpiry } from "./tier-utils.js";

const NOW = new Date("2026-07-11T10:00:00.000Z");

describe("paymentPeriod", () => {
  it("starts at now when there is no current expiry", () => {
    const { periodStart, periodEnd } = paymentPeriod(null, 1, NOW);
    expect(periodStart).toEqual(NOW);
    expect(periodEnd).toEqual(new Date("2026-08-11T10:00:00.000Z"));
  });

  it("starts at now when the current expiry is in the past (lapsed listing)", () => {
    const lapsed = new Date("2026-06-01T00:00:00.000Z");
    const { periodStart, periodEnd } = paymentPeriod(lapsed, 2, NOW);
    expect(periodStart).toEqual(NOW);
    expect(periodEnd).toEqual(new Date("2026-09-11T10:00:00.000Z"));
  });

  it("extends from the current expiry when it is still in the future (renewal)", () => {
    const future = new Date("2026-08-01T00:00:00.000Z");
    const { periodStart, periodEnd } = paymentPeriod(future, 1, NOW);
    expect(periodStart).toEqual(future);
    expect(periodEnd).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it("matches computeNewExpiry exactly — no parallel calendar math", () => {
    const cases: Array<[Date | null, number]> = [
      [null, 1],
      [new Date("2026-01-31T12:00:00.000Z"), 1], // end-of-month clamp
      [new Date("2026-12-15T00:00:00.000Z"), 3], // year rollover
    ];
    for (const [expiry, periods] of cases) {
      expect(paymentPeriod(expiry, periods, NOW).periodEnd).toEqual(
        computeNewExpiry(expiry, periods, NOW),
      );
    }
  });

  it("rejects non-positive and fractional period counts", () => {
    expect(() => paymentPeriod(null, 0, NOW)).toThrow(/positive integer/);
    expect(() => paymentPeriod(null, -1, NOW)).toThrow(/positive integer/);
    expect(() => paymentPeriod(null, 1.5, NOW)).toThrow(/positive integer/);
  });
});
