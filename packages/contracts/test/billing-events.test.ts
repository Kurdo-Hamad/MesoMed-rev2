import { describe, expect, it } from "vitest";
import { createEventRegistry } from "../src/events/index.js";
import {
  BILLING_EVENTS,
  chargeRecordedV1,
  chargeSettledV1,
  chargeVoidedV1,
  subscriptionActivatedV1,
  subscriptionExpiredV1,
  tierPaymentRecordedV1,
} from "../src/events/billing.js";
import { paymentWebhookBodySchema } from "../src/billing.js";

describe("billing event contracts", () => {
  it("exposes exactly the Phase 6 + 6b event set, all v1 (additive only)", () => {
    expect(BILLING_EVENTS.map((event) => event.name).sort()).toEqual([
      "billing.charge_recorded.v1",
      "billing.charge_settled.v1",
      "billing.charge_voided.v1",
      "billing.subscription_activated.v1",
      "billing.subscription_expired.v1",
      "billing.tier_payment_recorded.v1",
    ]);
  });

  it("registers cleanly into an event registry", () => {
    const registry = createEventRegistry(BILLING_EVENTS);
    expect(registry.names()).toHaveLength(BILLING_EVENTS.length);
  });

  it("subscription_activated carries the doctor reference and paid-until instant", () => {
    const parsed = subscriptionActivatedV1.envelope.parse({
      name: "billing.subscription_activated.v1",
      version: 1,
      payload: {
        subscriptionId: "s1",
        doctorProfileId: "d1",
        paidUntil: "2026-08-11T10:00:00.000Z",
      },
    });
    expect(parsed.payload.doctorProfileId).toBe("d1");
  });

  it("subscription_expired carries identifiers only", () => {
    const parsed = subscriptionExpiredV1.payload.parse({
      subscriptionId: "s1",
      doctorProfileId: "d1",
    });
    expect(parsed).toEqual({ subscriptionId: "s1", doctorProfileId: "d1" });
  });

  it("tier_payment_recorded carries the denormalized rank subscribers need", () => {
    const parsed = tierPaymentRecordedV1.payload.parse({
      tierPaymentId: "p1",
      facilityId: "f1",
      tierKey: "tier_1",
      tierRank: 1,
      periodStart: "2026-07-11T10:00:00.000Z",
      periodEnd: "2026-08-11T10:00:00.000Z",
      tierExpiresAt: "2026-08-11T10:00:00.000Z",
    });
    expect(parsed.tierRank).toBe(1);
  });

  it("charge_recorded carries the full charge identity in integer minor units", () => {
    const parsed = chargeRecordedV1.payload.parse({
      chargeId: "c1",
      providerId: "p1",
      payer: "provider",
      reason: "commission",
      amountMinor: 1_875_000,
      currency: "IQD",
      bookingId: "b1",
      subscriptionId: "s1",
      status: "pending",
    });
    expect(parsed.amountMinor).toBe(1_875_000);
    // Floats are forbidden anywhere money is represented.
    expect(() =>
      chargeRecordedV1.payload.parse({
        chargeId: "c1",
        providerId: "p1",
        payer: "provider",
        reason: "commission",
        amountMinor: 18.75,
        currency: "IQD",
        bookingId: "b1",
        subscriptionId: null,
        status: "pending",
      }),
    ).toThrow();
  });

  it("charge_settled carries only the gateway's opaque reference", () => {
    const parsed = chargeSettledV1.payload.parse({
      chargeId: "c1",
      providerId: "p1",
      payer: "patient",
      reason: "cancellation_fee",
      amountMinor: 5_000_000,
      currency: "IQD",
      gatewayId: "manual",
      gatewayChargeRef: "manual:key-1",
    });
    expect(parsed.gatewayId).toBe("manual");
  });

  it("charge_voided distinguishes void from refund reversals", () => {
    const parsed = chargeVoidedV1.payload.parse({
      chargeId: "c1",
      providerId: "p1",
      payer: "provider",
      reason: "per_booking_fee",
      amountMinor: 2_000_000,
      currency: "IQD",
      kind: "refund",
      reversalChargeId: "c2",
    });
    expect(parsed.kind).toBe("refund");
  });
});

describe("payment webhook envelope", () => {
  const base = {
    idempotencyKey: "delivery-0001",
    reference: "ref-1",
    amount: 150_000,
    currency: "IQD",
    periods: 1,
  };

  it("requires kind-specific target fields", () => {
    expect(() => paymentWebhookBodySchema.parse({ ...base, kind: "tier_payment" })).toThrow(
      /facilityId and tierKey/,
    );
    expect(() => paymentWebhookBodySchema.parse({ ...base, kind: "subscription" })).toThrow(
      /doctorProfileId/,
    );
    expect(
      paymentWebhookBodySchema.parse({
        ...base,
        kind: "subscription",
        doctorProfileId: "3f0f7f8a-6f1a-4b57-9d3e-0a1b2c3d4e5f",
      }).doctorProfileId,
    ).toBeDefined();
  });

  it("is strict: unknown fields are rejected, not stripped", () => {
    expect(() =>
      paymentWebhookBodySchema.parse({
        ...base,
        kind: "subscription",
        doctorProfileId: "3f0f7f8a-6f1a-4b57-9d3e-0a1b2c3d4e5f",
        injected: "value",
      }),
    ).toThrow();
  });
});
