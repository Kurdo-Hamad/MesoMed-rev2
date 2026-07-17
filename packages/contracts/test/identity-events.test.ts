import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { createEventRegistry } from "../src/events/index.js";
import {
  IDENTITY_EVENTS,
  patientProfileCreatedV1,
  patientProfileCreatedV2,
  profileClaimedV1,
  providerRecoveredV1,
  providerStatusChangedV1,
  roleAssignedV1,
  userRegisteredV1,
  userRegisteredV2,
} from "../src/events/identity.js";

describe("identity event contracts", () => {
  it("exposes exactly the identity event set: Phase 2 v1 + the F-04 id-only v2 pair", () => {
    expect(IDENTITY_EVENTS.map((event) => event.name).sort()).toEqual([
      "identity.patient_profile_created.v1",
      "identity.patient_profile_created.v2",
      "identity.profile_claimed.v1",
      "identity.provider_recovered.v1",
      "identity.provider_status_changed.v1",
      "identity.role_assigned.v1",
      "identity.user_registered.v1",
      "identity.user_registered.v2",
    ]);
  });

  it("registers cleanly into an event registry", () => {
    const registry = createEventRegistry(IDENTITY_EVENTS);
    expect(registry.names()).toHaveLength(IDENTITY_EVENTS.length);
  });

  it("no identity event payload schema beyond shipped v1 contains contact PII fields (MM-QA-004 F-04)", () => {
    // domain_events is retained indefinitely: every identity schema from
    // v2 onward (including any future event) must be ids only. The
    // shipped Phase 2 v1 contracts are excluded — owner ruling
    // 2026-07-17 (ADR-0032): shipped contract versions are never edited;
    // v1 is the historical record of what those rows contained, and
    // migration 0010 alone redacted the stored data.
    const SHIPPED_V1_NAMES = [
      "identity.patient_profile_created.v1",
      "identity.profile_claimed.v1",
      "identity.provider_recovered.v1",
      "identity.provider_status_changed.v1",
      "identity.role_assigned.v1",
      "identity.user_registered.v1",
    ];
    const PII_FIELDS = ["phone", "email", "normalizedPhone"];
    const checked = IDENTITY_EVENTS.filter((event) => !SHIPPED_V1_NAMES.includes(event.name));
    expect(checked.length).toBeGreaterThan(0);
    for (const event of checked) {
      const shape = (event.payload as z.ZodObject<z.ZodRawShape>).shape;
      expect(
        Object.keys(shape).filter((key) => PII_FIELDS.includes(key)),
        `${event.name} must not carry contact PII`,
      ).toEqual([]);
    }
  });

  it("user_registered.v2 carries the user id and type, nothing else", () => {
    const parsed = userRegisteredV2.envelope.parse({
      name: "identity.user_registered.v2",
      version: 2,
      payload: { userId: "u1", userType: "patient" },
    });
    expect(parsed.payload).toEqual({ userId: "u1", userType: "patient" });
    expect(() => userRegisteredV2.payload.parse({ userId: "u1", userType: "visitor" })).toThrow();
  });

  it("patient_profile_created.v2 carries the profile id and source, nothing else", () => {
    const payload = patientProfileCreatedV2.payload.parse({
      profileId: "p1",
      source: "guest_booking",
    });
    expect(payload).toEqual({ profileId: "p1", source: "guest_booking" });
    expect(() =>
      patientProfileCreatedV2.payload.parse({ profileId: "p1", source: "import" }),
    ).toThrow();
  });

  it("user_registered.v1 carries user type and contact identifiers, as shipped", () => {
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
      userRegisteredV1.payload.parse({
        userId: "u1",
        userType: "visitor",
        phone: null,
        email: null,
      }),
    ).toThrow();
  });

  it("patient_profile_created.v1 records the normalized phone and source, as shipped", () => {
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

  it("role_assigned only accepts platform roles", () => {
    expect(roleAssignedV1.payload.parse({ userId: "u1", role: "doctor" }).role).toBe("doctor");
    expect(() => roleAssignedV1.payload.parse({ userId: "u1", role: "superuser" })).toThrow();
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
      providerRecoveredV1.payload.parse({
        providerProfileId: "pp1",
        userId: "u1",
        recoveredBy: "admin1",
      }),
    ).toThrow();
  });
});
