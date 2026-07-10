import { describe, expect, it } from "vitest";
import { ErrorCode } from "../src/errors.js";
import {
  PROVIDER_STATUSES,
  PROVIDER_TYPES,
  claimProfileInputSchema,
  claimProfileOutputSchema,
  completeProviderSignupInputSchema,
  meResponseSchema,
  recoverProviderAccountInputSchema,
  setProviderStatusInputSchema,
} from "../src/identity.js";

describe("identity contracts", () => {
  it("provider status universe matches MM-DEC rev02 §3", () => {
    expect(PROVIDER_STATUSES).toEqual(["pending", "approved", "rejected"]);
  });

  it("provider types cover the MM-DEC provider categories", () => {
    expect(PROVIDER_TYPES).toContain("doctor");
    expect(PROVIDER_TYPES).toContain("hospital");
    expect(PROVIDER_TYPES).toContain("laboratory");
    expect(PROVIDER_TYPES).toContain("pharmacy");
    expect(PROVIDER_TYPES).toContain("home_nursing");
  });

  it("claimProfile takes a phone and returns the claimed profile id and proof", () => {
    expect(claimProfileInputSchema.parse({ phone: "0770 123 4567" })).toEqual({
      phone: "0770 123 4567",
    });
    const output = claimProfileOutputSchema.parse({
      profileId: "3b8e0d9e-5c3a-4f6e-9a2b-1c4d5e6f7a8b",
      proof: "verified-email",
    });
    expect(output.proof).toBe("verified-email");
    expect(() => claimProfileOutputSchema.parse({ profileId: "p", proof: "none" })).toThrow();
  });

  it("completeProviderSignup requires a provider type and operational phone", () => {
    const parsed = completeProviderSignupInputSchema.parse({
      providerType: "doctor",
      phone: "07701234567",
    });
    expect(parsed.providerType).toBe("doctor");
    expect(() =>
      completeProviderSignupInputSchema.parse({ providerType: "influencer", phone: "0770" }),
    ).toThrow();
  });

  it("setProviderStatus only accepts approve/reject decisions", () => {
    expect(
      setProviderStatusInputSchema.parse({
        providerProfileId: "3b8e0d9e-5c3a-4f6e-9a2b-1c4d5e6f7a8b",
        status: "approved",
      }).status,
    ).toBe("approved");
    expect(() =>
      setProviderStatusInputSchema.parse({
        providerProfileId: "3b8e0d9e-5c3a-4f6e-9a2b-1c4d5e6f7a8b",
        status: "pending",
      }),
    ).toThrow();
  });

  it("recoverProviderAccount requires a reason (audit trail)", () => {
    expect(() =>
      recoverProviderAccountInputSchema.parse({
        providerProfileId: "3b8e0d9e-5c3a-4f6e-9a2b-1c4d5e6f7a8b",
        reason: "",
      }),
    ).toThrow();
  });

  it("me response distinguishes patient and provider facets", () => {
    const me = meResponseSchema.parse({
      userId: "u1",
      roles: ["patient"],
      phone: "+9647701234567",
      email: null,
      patientProfile: { id: "3b8e0d9e-5c3a-4f6e-9a2b-1c4d5e6f7a8b", fullName: "Test" },
      providerProfile: null,
    });
    expect(me.patientProfile?.fullName).toBe("Test");
  });

  it("Phase 2 error codes exist and stay string-stable", () => {
    expect(ErrorCode.CONFLICT).toBe("CONFLICT");
    expect(ErrorCode.RATE_LIMITED).toBe("RATE_LIMITED");
    expect(ErrorCode.PROFILE_ALREADY_CLAIMED).toBe("PROFILE_ALREADY_CLAIMED");
    expect(ErrorCode.OTP_DELIVERY_FAILED).toBe("OTP_DELIVERY_FAILED");
    expect(ErrorCode.INVALID_STATUS_TRANSITION).toBe("INVALID_STATUS_TRANSITION");
    expect(ErrorCode.PHONE_NOT_VERIFIED).toBe("PHONE_NOT_VERIFIED");
    expect(ErrorCode.EMAIL_NOT_VERIFIED).toBe("EMAIL_NOT_VERIFIED");
  });
});
