import { describe, expect, it } from "vitest";
import { createEventRegistry } from "../src/events/index.js";
import {
  BILLING_EVENTS,
  subscriptionActivatedV1,
  subscriptionExpiredV1,
  tierPaymentRecordedV1,
} from "../src/events/billing.js";
import { paymentWebhookBodySchema } from "../src/billing.js";

describe("billing event contracts", () => {
  it("exposes exactly the Phase 6 event set, all v1", () => {
    expect(BILLING_EVENTS.map((event) => event.name).sort()).toEqual([
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
