import { describe, expect, it } from "vitest";
import { needsRtlReload } from "../lib/rtl.js";

describe("needsRtlReload", () => {
  it("is true when an RTL locale loads under an LTR native layout", () => {
    expect(needsRtlReload("ckb", false)).toBe(true);
    expect(needsRtlReload("ar", false)).toBe(true);
  });

  it("is true when an LTR locale loads under an RTL native layout", () => {
    expect(needsRtlReload("en", true)).toBe(true);
  });

  it("is false once the native layout already matches the locale", () => {
    expect(needsRtlReload("ckb", true)).toBe(false);
    expect(needsRtlReload("ar", true)).toBe(false);
    expect(needsRtlReload("en", false)).toBe(false);
  });
});
