import { describe, expect, it } from "vitest";

import { decideClaim } from "./claim-policy.js";

describe("decideClaim", () => {
  const caller = "user-a";

  it("claims an existing unclaimed guest profile", () => {
    expect(
      decideClaim({ proofVerified: true, callerUserId: caller, profile: { userId: null } }),
    ).toEqual({ action: "claim" });
  });

  it("creates a fresh claimed profile when none exists for the phone", () => {
    expect(decideClaim({ proofVerified: true, callerUserId: caller, profile: null })).toEqual({
      action: "create",
    });
  });

  it("is idempotent when the caller already owns the profile", () => {
    expect(
      decideClaim({ proofVerified: true, callerUserId: caller, profile: { userId: caller } }),
    ).toEqual({ action: "already-owned" });
  });

  it("rejects when the profile is claimed by another user", () => {
    expect(
      decideClaim({ proofVerified: true, callerUserId: caller, profile: { userId: "user-b" } }),
    ).toEqual({ action: "reject", reason: "owned-by-other" });
  });

  it("rejects any claim without verified proof — no unverified claim path exists", () => {
    // Regardless of profile state, unverified proof must never claim.
    for (const profile of [null, { userId: null }, { userId: caller }, { userId: "user-b" }]) {
      expect(decideClaim({ proofVerified: false, callerUserId: caller, profile })).toEqual({
        action: "reject",
        reason: "proof-not-verified",
      });
    }
  });
});
