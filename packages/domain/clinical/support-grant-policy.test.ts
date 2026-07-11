import { describe, expect, it } from "vitest";
import {
  evaluateGrantUse,
  MAX_GRANT_WINDOW_MS,
  validateGrantWindow,
} from "./support-grant-policy.js";

const NOW = new Date("2026-07-11T12:00:00Z");

describe("validateGrantWindow", () => {
  it("accepts an expiry inside the window", () => {
    expect(validateGrantWindow(NOW, new Date(NOW.getTime() + 60_000))).toEqual({ ok: true });
    expect(validateGrantWindow(NOW, new Date(NOW.getTime() + MAX_GRANT_WINDOW_MS))).toEqual({
      ok: true,
    });
  });

  it("rejects an expiry at or before now", () => {
    expect(validateGrantWindow(NOW, NOW)).toEqual({ ok: false, reason: "expiry_not_in_future" });
    expect(validateGrantWindow(NOW, new Date(NOW.getTime() - 1))).toEqual({
      ok: false,
      reason: "expiry_not_in_future",
    });
  });

  it("rejects a window longer than the policy maximum", () => {
    expect(validateGrantWindow(NOW, new Date(NOW.getTime() + MAX_GRANT_WINDOW_MS + 1))).toEqual({
      ok: false,
      reason: "window_too_long",
    });
  });
});

describe("evaluateGrantUse", () => {
  const grant = {
    adminUserId: "admin-1",
    expiresAt: new Date(NOW.getTime() + 60_000),
    revokedAt: null,
  };

  it("allows the granted admin inside the window", () => {
    expect(evaluateGrantUse(grant, "admin-1", NOW)).toEqual({ ok: true });
  });

  it("rejects a different admin", () => {
    expect(evaluateGrantUse(grant, "admin-2", NOW)).toEqual({ ok: false, reason: "wrong_admin" });
  });

  it("rejects a revoked grant", () => {
    expect(evaluateGrantUse({ ...grant, revokedAt: NOW }, "admin-1", NOW)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("rejects at and after the expiry instant", () => {
    expect(evaluateGrantUse(grant, "admin-1", grant.expiresAt)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(evaluateGrantUse(grant, "admin-1", new Date(grant.expiresAt.getTime() + 1))).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
