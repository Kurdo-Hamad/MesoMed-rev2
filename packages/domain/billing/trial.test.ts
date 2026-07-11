import { describe, expect, it } from "vitest";
import { isInTrial, trialEndsAt } from "./trial.js";

const anchor = new Date("2026-01-15T10:00:00.000Z");

describe("trialEndsAt", () => {
  it("applies the global default window from the anchor", () => {
    expect(trialEndsAt({ trialOverride: null, anchor, defaultMonths: 6 })?.toISOString()).toBe(
      "2026-07-15T10:00:00.000Z",
    );
  });

  it("clamps end-of-month like every other billing window", () => {
    expect(
      trialEndsAt({
        trialOverride: null,
        anchor: new Date("2026-01-31T00:00:00.000Z"),
        defaultMonths: 1,
      })?.toISOString(),
    ).toBe("2026-02-28T00:00:00.000Z");
  });

  it("a per-provider override wins over the global default", () => {
    const override = new Date("2026-03-01T00:00:00.000Z");
    expect(trialEndsAt({ trialOverride: override, anchor, defaultMonths: 6 })).toEqual(override);
  });

  it("no override and no default → no trial", () => {
    expect(trialEndsAt({ trialOverride: null, anchor, defaultMonths: 0 })).toBeNull();
  });

  it("rejects invalid month counts", () => {
    expect(() => trialEndsAt({ trialOverride: null, anchor, defaultMonths: -1 })).toThrow();
    expect(() => trialEndsAt({ trialOverride: null, anchor, defaultMonths: 1.5 })).toThrow();
  });
});

describe("isInTrial", () => {
  const input = { trialOverride: null, anchor, defaultMonths: 6 };

  it("true strictly before the trial end, false at and after it", () => {
    expect(isInTrial(new Date("2026-07-15T09:59:59.999Z"), input)).toBe(true);
    expect(isInTrial(new Date("2026-07-15T10:00:00.000Z"), input)).toBe(false);
    expect(isInTrial(new Date("2026-08-01T00:00:00.000Z"), input)).toBe(false);
  });

  it("false when no trial applies at all", () => {
    expect(isInTrial(anchor, { trialOverride: null, anchor, defaultMonths: 0 })).toBe(false);
  });
});
