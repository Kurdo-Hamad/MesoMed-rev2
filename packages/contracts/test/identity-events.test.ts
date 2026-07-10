import { describe, expect, it } from "vitest";
import { createEventRegistry } from "../src/events/index.js";
import {
  IDENTITY_EVENTS,
  patientProfileCreatedV1,
  profileClaimedV1,
  providerRecoveredV1,
  providerStatusChangedV1,
  roleAssignedV1,
  userRegisteredV1,
} from "../src/events/identity.js";

describe("identity event contracts", () => {
  it("exposes exactly the Phase 2 event set, all v1", () => {
    expect(IDENTITY_EVENTS.map((event) => event.name).sort()).toEqual([
      "identity.patient_profile_created.v1",
      "identity.profile_claimed.v1",
      "identity.provider_recovered.v1",
      "identity.provider_status_changed.v1",
      "identity.role_assigned.v1",
      "identity.user_registered.v1",
    ]);
  });

  it("registers cleanly into an event registry", () => {
    const registry = createEventRegistry(IDENTITY_EVENTS);
    expect(registry.names()).toHaveLength(IDENTITY_EVENTS.length);
  });

  it("user_registered carries user type and contact identifiers", () => {
    const parsed = userRegisteredV1.envelope.parse({
      name: "identity.user_registered.v1",
      version: 1,
      payload: {
        userId: "u1",
        userType: "patient",
        phone: "+9647701234567",
        email: null,
      },
    });
    expect(parsed.payload.userType).toBe("patient");
    expect(() =>
      userRegisteredV1.payload.parse({ userId: "u1", userType: "visitor", phone: null, email: null }),
    ).toThrow();
  });

  it("role_assigned only accepts platform roles", () => {
    expect(roleAssignedV1.payload.parse({ userId: "u1", role: "doctor" }).role).toBe("doctor");
    expect(() => roleAssignedV1.payload.parse({ userId: "u1", role: "superuser" })).toThrow();
  });

  it("patient_profile_created records the normalized phone and source", () => {
    const payload = patientProfileCreatedV1.payload.parse({
      profileId: "p1",
      normalizedPhone: "+9647701234567",
      source: "guest_booking",
    });
    expect(payload.source).toBe("guest_booking");
    expect(() =>
      patientProfileCreatedV1.payload.parse({
        profileId: "p1",
        normalizedPhone: "+9647701234567",
        source: "import",
      }),
    ).toThrow();
  });

  it("profile_claimed records which ownership proof was used", () => {
    const payload = profileClaimedV1.payload.parse({
      profileId: "p1",
      userId: "u1",
      proof: "otp-verified-phone",
    });
    expect(payload.proof).toBe("otp-verified-phone");
    expect(() =>
      profileClaimedV1.payload.parse({ profileId: "p1", userId: "u1", proof: "trust-me" }),
    ).toThrow();
  });

  it("provider_status_changed records the transition and actor", () => {
    const payload = providerStatusChangedV1.payload.parse({
      providerProfileId: "pp1",
      userId: "u1",
      from: "pending",
      to: "approved",
      changedBy: "admin1",
      reason: null,
    });
    expect(payload.to).toBe("approved");
    expect(() =>
      providerStatusChangedV1.payload.parse({
        providerProfileId: "pp1",
        userId: "u1",
        from: "pending",
        to: "live",
        changedBy: "admin1",
        reason: null,
      }),
    ).toThrow();
  });

  it("provider_recovered is an audit record with actor and reason", () => {
    const payload = providerRecoveredV1.payload.parse({
      providerProfileId: "pp1",
      userId: "u1",
      recoveredBy: "admin1",
      reason: "identity verified over phone",
    });
    expect(payload.recoveredBy).toBe("admin1");
    expect(() =>
      providerRecoveredV1.payload.parse({ providerProfileId: "pp1", userId: "u1", recoveredBy: "admin1" }),
    ).toThrow();
  });
});
