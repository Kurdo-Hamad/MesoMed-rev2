import { describe, expect, it } from "vitest";

import { normalizePhone } from "./normalize-phone.js";

describe("normalizePhone", () => {
  it("normalizes a local Iraqi mobile number (07XXXXXXXXX) to E.164", () => {
    expect(normalizePhone("07701234567")).toBe("+9647701234567");
  });

  it("passes through a valid E.164 Iraqi number unchanged", () => {
    expect(normalizePhone("+9647701234567")).toBe("+9647701234567");
  });

  it("normalizes 00-prefixed international format", () => {
    expect(normalizePhone("009647701234567")).toBe("+9647701234567");
  });

  it("normalizes a 964-prefixed number without plus", () => {
    expect(normalizePhone("9647701234567")).toBe("+9647701234567");
  });

  it("strips spaces, dashes and parentheses", () => {
    expect(normalizePhone("0770 123-4567")).toBe("+9647701234567");
    expect(normalizePhone("(0770) 123 45 67")).toBe("+9647701234567");
    expect(normalizePhone("+964 770 123 4567")).toBe("+9647701234567");
  });

  it("treats two spellings of the same number identically", () => {
    expect(normalizePhone("07701234567")).toBe(normalizePhone("+964 770 123 4567"));
  });

  it("passes through valid non-Iraqi E.164 numbers", () => {
    expect(normalizePhone("+491701234567")).toBe("+491701234567");
    expect(normalizePhone("+12025550123")).toBe("+12025550123");
  });

  it("rejects garbage input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("not-a-phone")).toBeNull();
    expect(normalizePhone("+964abc1234567")).toBeNull();
  });

  it("rejects numbers that are too short or too long", () => {
    expect(normalizePhone("0770123")).toBeNull();
    expect(normalizePhone("+96477012345678901")).toBeNull();
    expect(normalizePhone("+1")).toBeNull();
  });

  it("rejects local Iraqi numbers that are not mobile-shaped (not 07…)", () => {
    // Landline-style local numbers are out of scope for patient identity.
    expect(normalizePhone("017012345")).toBeNull();
  });

  it("rejects E.164 with leading zero after country code", () => {
    expect(normalizePhone("+96407701234567")).toBeNull();
  });
});
