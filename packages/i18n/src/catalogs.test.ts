import { describe, expect, it } from "vitest";
import { locales } from "./index.js";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("message catalogs", () => {
  it("en, ar and ckb carry identical key sets (no locale drifts)", () => {
    const en = keyPaths(locales.en).sort();
    expect(keyPaths(locales.ar).sort()).toEqual(en);
    expect(keyPaths(locales.ckb).sort()).toEqual(en);
  });

  it("every locale has the Phase 2 identity/OTP/error keys", () => {
    for (const catalog of Object.values(locales)) {
      const keys = keyPaths(catalog);
      expect(keys).toContain("identity.otp.message");
      expect(keys).toContain("identity.email.verifySubject");
      expect(keys).toContain("identity.email.verifyBody");
      for (const code of [
        "CONFLICT",
        "RATE_LIMITED",
        "PROFILE_ALREADY_CLAIMED",
        "OTP_DELIVERY_FAILED",
        "INVALID_STATUS_TRANSITION",
        "PHONE_NOT_VERIFIED",
        "EMAIL_NOT_VERIFIED",
      ]) {
        expect(keys).toContain(`errors.${code}`);
      }
    }
  });

  it("no catalog value is empty", () => {
    for (const catalog of Object.values(locales)) {
      const walk = (value: unknown): void => {
        if (typeof value === "string") {
          expect(value.trim().length).toBeGreaterThan(0);
        } else if (typeof value === "object" && value !== null) {
          Object.values(value).forEach(walk);
        }
      };
      walk(catalog);
    }
  });
});
