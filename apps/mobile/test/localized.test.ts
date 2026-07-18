import { describe, expect, it } from "vitest";
import { pickOptionalText, pickText, type LocalizedText } from "../lib/localized.js";

/**
 * MM-QA-004 F-14 (closes MM-QA-003 remediation item 4): pure-logic tests
 * for the mobile localized-text helpers per the Testing DoD. The fallback
 * order is the platform default ckb → ar → en, and "" counts as absent.
 */
describe("pickText", () => {
  const full: LocalizedText = { en: "Hospital", ar: "مستشفى", ckb: "نەخۆشخانە" };

  it("returns the requested locale when present", () => {
    expect(pickText(full, "en")).toBe("Hospital");
    expect(pickText(full, "ar")).toBe("مستشفى");
    expect(pickText(full, "ckb")).toBe("نەخۆشخانە");
  });

  it("falls back ckb → ar → en when the requested locale is empty", () => {
    expect(pickText({ en: "E", ar: "A", ckb: "" }, "ckb")).toBe("A");
    expect(pickText({ en: "E", ar: "", ckb: "" }, "ckb")).toBe("E");
    expect(pickText({ en: "E", ar: "", ckb: "K" }, "ar")).toBe("K");
  });

  it("returns the en value when every other locale is empty (last resort)", () => {
    expect(pickText({ en: "E", ar: "", ckb: "" }, "ar")).toBe("E");
  });
});

describe("pickOptionalText", () => {
  it("passes through null", () => {
    expect(pickOptionalText(null, "ckb")).toBeNull();
  });

  it("maps an all-empty text to null (optional columns hold empty strings)", () => {
    expect(pickOptionalText({ en: "", ar: "", ckb: "" }, "ckb")).toBeNull();
  });

  it("resolves like pickText when content exists", () => {
    expect(pickOptionalText({ en: "E", ar: "", ckb: "" }, "ckb")).toBe("E");
  });
});
