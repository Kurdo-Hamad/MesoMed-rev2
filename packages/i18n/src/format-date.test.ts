import { describe, expect, it } from "vitest";
import { formatLocalizedDate, formatNumericDate } from "./format-date.js";

// 2026-01-21: month 1 would render as a localized month name via
// Intl.DateTimeFormat's "long"/"short" styles, and both ar and ckb would
// render "21"/"1"/"2026" using Arabic-Indic digits by default — exactly the
// two failure modes ADR-0016 deviation #3 flags.
const TRIGGER_DATE = new Date("2026-01-21T12:00:00Z");

describe("formatNumericDate", () => {
  it("renders d/M/yyyy with ASCII digits regardless of locale", () => {
    expect(formatNumericDate(TRIGGER_DATE, { timeZone: "UTC" })).toBe("21/1/2026");
  });
});

describe("formatLocalizedDate", () => {
  it("renders ckb as numeric d/M/yyyy with ASCII digits, no month name", () => {
    const result = formatLocalizedDate(TRIGGER_DATE, "ckb", {
      dateStyle: "full",
      timeZone: "UTC",
    });
    expect(result).toBe("21/1/2026");
    expect(result).toMatch(/^[0-9/]+$/);
  });

  it("renders ar as numeric d/M/yyyy with ASCII digits, no month name", () => {
    const result = formatLocalizedDate(TRIGGER_DATE, "ar", {
      dateStyle: "full",
      timeZone: "UTC",
    });
    expect(result).toBe("21/1/2026");
    expect(result).toMatch(/^[0-9/]+$/);
  });

  it("leaves en unchanged (long-form Intl output)", () => {
    const result = formatLocalizedDate(TRIGGER_DATE, "en", {
      dateStyle: "full",
      timeZone: "UTC",
    });
    expect(result).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" }).format(TRIGGER_DATE),
    );
  });

  it("appends a time portion for ckb/ar when timeStyle is requested", () => {
    const result = formatLocalizedDate(TRIGGER_DATE, "ckb", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "UTC",
    });
    expect(result.startsWith("21/1/2026, ")).toBe(true);
  });
});
