import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  PAYMENT_ROUTING_CONFIG_KEY,
  paymentRoutingSchema,
  resolvePaymentGatewayId,
  type ConfigReader,
} from "../src/index.js";

function readerWith(value: unknown): ConfigReader {
  return {
    get: <Schema extends z.ZodType>(schema: Schema, key: string) => {
      expect(key).toBe(PAYMENT_ROUTING_CONFIG_KEY);
      return Promise.resolve(schema.parse(value) as z.output<Schema>);
    },
  };
}

describe("paymentRoutingSchema", () => {
  it("accepts partial per-country kind maps and rejects malformed entries", () => {
    expect(
      paymentRoutingSchema.parse({ IQ: { tier_payment: "manual", subscription: "manual" } }),
    ).toEqual({ IQ: { tier_payment: "manual", subscription: "manual" } });
    // Partial: a country may route only the kinds it has launched.
    expect(paymentRoutingSchema.parse({ IQ: { subscription: "fib" } })).toEqual({
      IQ: { subscription: "fib" },
    });
    expect(() => paymentRoutingSchema.parse({ iq: { subscription: "manual" } })).toThrow();
    expect(() => paymentRoutingSchema.parse({ IQ: { refund: "manual" } })).toThrow();
    expect(() => paymentRoutingSchema.parse({ IQ: { subscription: "" } })).toThrow();
  });
});

describe("resolvePaymentGatewayId", () => {
  it("resolves configured routes, case-insensitively on country", async () => {
    const reader = readerWith({ IQ: { tier_payment: "manual" } });
    await expect(resolvePaymentGatewayId(reader, "IQ", "tier_payment")).resolves.toBe("manual");
    await expect(resolvePaymentGatewayId(reader, "iq", "tier_payment")).resolves.toBe("manual");
  });

  it("fails closed (null) for unrouted countries, kinds and a missing entry", async () => {
    const reader = readerWith({ IQ: { tier_payment: "manual" } });
    await expect(resolvePaymentGatewayId(reader, "JO", "tier_payment")).resolves.toBeNull();
    await expect(resolvePaymentGatewayId(reader, "IQ", "subscription")).resolves.toBeNull();

    const notFound: ConfigReader = {
      get: () => Promise.reject(Object.assign(new Error("missing"), { code: "NOT_FOUND" })),
    };
    await expect(resolvePaymentGatewayId(notFound, "IQ", "tier_payment")).resolves.toBeNull();
  });

  it("propagates non-NOT_FOUND failures instead of masking an outage", async () => {
    const broken: ConfigReader = {
      get: () => Promise.reject(new Error("connection refused")),
    };
    await expect(resolvePaymentGatewayId(broken, "IQ", "tier_payment")).rejects.toThrow(
      "connection refused",
    );
  });
});
