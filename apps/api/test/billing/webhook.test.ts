import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { doctorProfiles, domainEvents, eq, tierPayments } from "@mesomed/db";
import {
  buildBillingTestServer,
  nextIdempotencyKey,
  seedBillingFixture,
  signTestpay,
  TESTPAY_GATEWAY_ID,
  TESTPAY_SIGNATURE_HEADER,
  waitFor,
  type BillingFixture,
} from "./helpers.js";

/**
 * Phase 6 gate (MM-PLAN-001 §5): the webhook endpoint rejects unsigned and
 * invalid-schema requests, rate-limits, and settles idempotently — the
 * fixes for the old codebase's documented gaps, proven against the real
 * PaymentGateway interface via the signature-verifying test adapter.
 */
describe("payment webhooks", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let fx: BillingFixture;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBillingTestServer(tdb.connectionString);
    await app.ready();
    fx = await seedBillingFixture(app);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  function tierBody(idempotencyKey: string): Record<string, unknown> {
    return {
      idempotencyKey,
      reference: `testpay-ref-${idempotencyKey}`,
      kind: "tier_payment",
      amount: 150_000,
      currency: "IQD",
      periods: 1,
      facilityId: fx.facilityId,
      tierKey: "tier_1",
    };
  }

  function deliver(gateway: string, rawBody: string, headers: Record<string, string> = {}) {
    return app.inject({
      method: "POST",
      url: `/webhooks/payments/${gateway}`,
      headers: { "content-type": "application/json", ...headers },
      payload: rawBody,
    });
  }

  function signedDelivery(body: Record<string, unknown>) {
    const rawBody = JSON.stringify(body);
    return deliver(TESTPAY_GATEWAY_ID, rawBody, {
      [TESTPAY_SIGNATURE_HEADER]: signTestpay(rawBody),
    });
  }

  it("rejects unknown and unconfigured gateways with 404", async () => {
    const rawBody = JSON.stringify(tierBody(nextIdempotencyKey("wh")));
    expect((await deliver("nonexistent", rawBody)).statusCode).toBe(404);
    // Adapter registered but unconfigured (no credentials) — also 404.
    expect((await deliver("offlinepay", rawBody)).statusCode).toBe(404);
  });

  it("rejects the manual gateway — it has no webhook channel", async () => {
    const res = await deliver("manual", JSON.stringify(tierBody(nextIdempotencyKey("wh"))));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "WEBHOOK_UNSUPPORTED" });
  });

  it("rejects malformed JSON and schema-invalid bodies with 400", async () => {
    const notJson = await deliver(TESTPAY_GATEWAY_ID, "{not-json", {
      [TESTPAY_SIGNATURE_HEADER]: signTestpay("{not-json"),
    });
    expect(notJson.statusCode).toBe(400);
    expect(notJson.json()).toEqual({ error: "INVALID_JSON" });

    // kind=tier_payment without its target fields fails the Zod envelope.
    const invalid = { ...tierBody(nextIdempotencyKey("wh")), facilityId: undefined };
    const rawBody = JSON.stringify(invalid);
    const badSchema = await deliver(TESTPAY_GATEWAY_ID, rawBody, {
      [TESTPAY_SIGNATURE_HEADER]: signTestpay(rawBody),
    });
    expect(badSchema.statusCode).toBe(400);
    expect(badSchema.json()).toEqual({ error: "INVALID_SCHEMA" });

    // Unknown extra fields are rejected too (strict envelope).
    const extra = { ...tierBody(nextIdempotencyKey("wh")), sneaky: true };
    const rawExtra = JSON.stringify(extra);
    const extraRes = await deliver(TESTPAY_GATEWAY_ID, rawExtra, {
      [TESTPAY_SIGNATURE_HEADER]: signTestpay(rawExtra),
    });
    expect(extraRes.statusCode).toBe(400);
  });

  it("rejects unsigned and mis-signed deliveries with 401", async () => {
    const rawBody = JSON.stringify(tierBody(nextIdempotencyKey("wh")));

    const unsigned = await deliver(TESTPAY_GATEWAY_ID, rawBody);
    expect(unsigned.statusCode).toBe(401);
    expect(unsigned.json()).toEqual({ error: "INVALID_SIGNATURE" });

    const misSigned = await deliver(TESTPAY_GATEWAY_ID, rawBody, {
      [TESTPAY_SIGNATURE_HEADER]: signTestpay(rawBody, "wrong-secret"),
    });
    expect(misSigned.statusCode).toBe(401);

    // Tampered body under a signature for different bytes.
    const tampered = await deliver(TESTPAY_GATEWAY_ID, rawBody.replace("150000", "1"), {
      [TESTPAY_SIGNATURE_HEADER]: signTestpay(rawBody),
    });
    expect(tampered.statusCode).toBe(401);

    // Nothing was settled by any of the rejects.
    const rows = await app.kernel.db
      .select()
      .from(tierPayments)
      .where(eq(tierPayments.facilityId, fx.facilityId));
    expect(rows).toHaveLength(0);
  });

  it("settles a signed tier payment once; duplicate deliveries are no-ops", async () => {
    const key = nextIdempotencyKey("wh-settle");
    const body = tierBody(key);

    const first = await signedDelivery(body);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true, applied: true });

    const [payment] = await app.kernel.db
      .select()
      .from(tierPayments)
      .where(eq(tierPayments.idempotencyKey, key));
    expect(payment?.recordedBy).toBe(`gateway:${TESTPAY_GATEWAY_ID}`);
    expect(payment?.gateway).toBe(TESTPAY_GATEWAY_ID);

    const events = await app.kernel.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.name, "billing.tier_payment_recorded.v1"));

    // The gateway retries the exact same delivery — 200 (stop retrying),
    // applied:false, and NOTHING changed.
    const replay = await signedDelivery(body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ received: true, applied: false });

    const rows = await app.kernel.db
      .select()
      .from(tierPayments)
      .where(eq(tierPayments.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    const eventsAfter = await app.kernel.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.name, "billing.tier_payment_recorded.v1"));
    expect(eventsAfter).toHaveLength(events.length);
  });

  it("rejects settlement against unknown targets with a typed 400", async () => {
    const body = {
      ...tierBody(nextIdempotencyKey("wh-bad-target")),
      facilityId: "00000000-0000-4000-8000-000000000000",
    };
    const res = await signedDelivery(body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("settles a signed subscription payment and the visibility flip follows", async () => {
    const body = {
      idempotencyKey: nextIdempotencyKey("wh-sub"),
      reference: "testpay-sub-1",
      kind: "subscription",
      amount: 50_000,
      currency: "IQD",
      periods: 1,
      doctorProfileId: fx.doctorProfileId,
    };
    const res = await signedDelivery(body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, applied: true });

    // Webhook settlement drives the same event → subscriber → flip chain.
    await waitFor(async () => {
      const [doctor] = await app.kernel.db
        .select({ publiclyVisible: doctorProfiles.publiclyVisible })
        .from(doctorProfiles)
        .where(eq(doctorProfiles.id, fx.doctorProfileId));
      return doctor?.publiclyVisible ? doctor : undefined;
    });
  });
});

describe("payment webhook rate limiting", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBillingTestServer(tdb.connectionString, {
      WEBHOOK_RATE_LIMIT_MAX: "3",
      WEBHOOK_RATE_LIMIT_WINDOW_MS: "60000",
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("fires 429 once the per-window budget is exhausted", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/webhooks/payments/manual",
        headers: { "content-type": "application/json" },
        payload: "{}",
      });
      statuses.push(res.statusCode);
    }
    // Budget of 3: the first three pass the limiter (and fail later checks
    // as expected); the fourth is throttled at the door.
    expect(statuses.slice(0, 3).every((code) => code !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);

    // The limiter is scoped to the webhook surface — tRPC stays open.
    const health = await app.inject({ method: "GET", url: "/trpc/health.check" });
    expect(health.statusCode).toBe(200);
  });
});
