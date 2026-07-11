import { describe, expect, it } from "vitest";
import { createManualPaymentGateway, MANUAL_GATEWAY_ID } from "./payments-manual.js";
import { WebhookUnsupportedError } from "./payments.js";

describe("manual payment gateway", () => {
  const gateway = createManualPaymentGateway();

  it("is always configured and carries the stable id", () => {
    expect(gateway.id).toBe(MANUAL_GATEWAY_ID);
    expect(gateway.isConfigured()).toBe(true);
  });

  it("settles initiation synchronously with a deterministic reference", async () => {
    const input = {
      idempotencyKey: "adm-2026-07-0001",
      kind: "tier_payment" as const,
      amount: 150_000,
      currency: "IQD",
      description: "tier_1 × 1 month",
    };
    const first = await gateway.initiatePayment(input);
    const second = await gateway.initiatePayment(input);
    expect(first.status).toBe("settled");
    expect(first.redirectUrl).toBeNull();
    expect(first.reference).toBe("manual:adm-2026-07-0001");
    expect(second.reference).toBe(first.reference);
  });

  it("verifies only references it minted", async () => {
    await expect(gateway.verifyPayment("manual:adm-2026-07-0001")).resolves.toMatchObject({
      status: "settled",
    });
    await expect(gateway.verifyPayment("fib:whatever")).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("rejects webhook deliveries — no webhook channel exists", async () => {
    await expect(gateway.handleWebhook({ rawBody: "{}", headers: {} })).rejects.toBeInstanceOf(
      WebhookUnsupportedError,
    );
  });
});
