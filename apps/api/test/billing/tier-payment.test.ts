import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  facilityTierStateOutputSchema,
  listTiersOutputSchema,
  recordTierPaymentResultSchema,
} from "@mesomed/contracts";
import { domainEvents, eq, facilities, facilityTiers, tierPayments } from "@mesomed/db";
import {
  ADMIN,
  buildBillingTestServer,
  nextIdempotencyKey,
  result,
  seedBillingFixture,
  trpc,
  waitFor,
  type BillingFixture,
} from "./helpers.js";

/**
 * Phase 6 gate (MM-PLAN-001 §5): duplicate tier-payment replays are no-ops
 * under BOTH ported constraints — the idempotency key and the
 * (facility, tier, period_start, period_end) tuple — and recording extends
 * billing's own tier_expires_at atomically in the payment transaction,
 * with the directory's denormalized copy following via the outbox.
 */
describe("tier payments", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let fx: BillingFixture;

  const session = { ...ADMIN, user: "admin-under-test" };

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

  async function record(input: Record<string, unknown>) {
    const res = await trpc(
      app,
      "billing.recordTierPayment",
      "mutation",
      { facilityId: fx.facilityId, ...input },
      { ...session, country: "IQ" },
    );
    expect(res.statusCode).toBe(200);
    return recordTierPaymentResultSchema.parse(result(res));
  }

  async function billingTierState() {
    const [row] = await app.kernel.db
      .select()
      .from(facilityTiers)
      .where(eq(facilityTiers.facilityId, fx.facilityId));
    return row;
  }

  function eventCount(name: string): Promise<number> {
    return app.kernel.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.name, name))
      .then((rows) => rows.length);
  }

  it("lists tiers with country pricing (contract round-trip)", async () => {
    const res = await trpc(app, "billing.listTiers", "query", undefined, { country: "IQ" });
    expect(res.statusCode).toBe(200);
    const { tiers } = listTiersOutputSchema.parse(result(res));
    expect(tiers.map((t) => t.key)).toEqual(["tier_1", "tier_2", "tier_3"]);
    expect(tiers[0]?.price).toEqual({ amount: 150_000, currency: "IQD" });
  });

  it("records a payment: ledger row, atomic expiry extension, outbox event, directory mirror", async () => {
    const key = nextIdempotencyKey("tier");
    const outcome = await record({ idempotencyKey: key, tierKey: "tier_1" });
    expect(outcome.applied).toBe(true);
    expect(outcome.tierPaymentId).not.toBeNull();
    expect(outcome.tierExpiresAt).not.toBeNull();

    // Billing's own tier state was extended in the same transaction.
    const state = await billingTierState();
    expect(state?.tierExpiresAt.toISOString()).toBe(outcome.tierExpiresAt);

    const [payment] = await app.kernel.db
      .select()
      .from(tierPayments)
      .where(eq(tierPayments.idempotencyKey, key));
    expect(payment?.gateway).toBe("manual");
    expect(payment?.recordedBy).toBe("admin-under-test");
    // Priced from the (tier, country) config row — never typed by the admin.
    expect(payment?.amount).toBe(150_000);

    // The directory's denormalized copy follows via the dispatcher.
    await waitFor(async () => {
      const [facility] = await app.kernel.db
        .select({ tierRank: facilities.tierRank, tierExpiresAt: facilities.tierExpiresAt })
        .from(facilities)
        .where(eq(facilities.id, fx.facilityId));
      return facility?.tierRank === 1 ? facility : undefined;
    });
  });

  it("is a no-op on idempotency-key replay: no extension, no second event", async () => {
    const key = nextIdempotencyKey("tier-replay");
    const first = await record({ idempotencyKey: key, tierKey: "tier_1" });
    expect(first.applied).toBe(true);
    const recorded = await eventCount("billing.tier_payment_recorded.v1");

    const replay = await record({ idempotencyKey: key, tierKey: "tier_1" });
    expect(replay.applied).toBe(false);
    expect(replay.tierPaymentId).toBeNull();
    // Expiry unchanged — the replay extended nothing.
    expect(replay.tierExpiresAt).toBe(first.tierExpiresAt);
    expect((await billingTierState())?.tierExpiresAt.toISOString()).toBe(first.tierExpiresAt);

    const rows = await app.kernel.db
      .select()
      .from(tierPayments)
      .where(eq(tierPayments.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    expect(await eventCount("billing.tier_payment_recorded.v1")).toBe(recorded);
  });

  it("is a no-op on a period-tuple replay under a DIFFERENT idempotency key", async () => {
    // Establish a known future expiry E1, then pay again → period [E1, E2].
    const first = await record({ idempotencyKey: nextIdempotencyKey("tuple"), tierKey: "tier_1" });
    const e1 = (await billingTierState())!.tierExpiresAt;
    void first;
    const second = await record({ idempotencyKey: nextIdempotencyKey("tuple"), tierKey: "tier_1" });
    expect(second.applied).toBe(true);
    const e2 = (await billingTierState())!.tierExpiresAt;

    // Simulate the divergence this constraint guards against (state restored
    // from backup / re-imported ledger): billing tier state says E1 again,
    // but the ledger already holds the [E1, E2] period.
    await app.kernel.db
      .update(facilityTiers)
      .set({ tierExpiresAt: e1 })
      .where(eq(facilityTiers.facilityId, fx.facilityId));

    const paymentsBefore = await app.kernel.db
      .select()
      .from(tierPayments)
      .where(eq(tierPayments.facilityId, fx.facilityId));
    const recorded = await eventCount("billing.tier_payment_recorded.v1");

    // Fresh key, same computed (facility, tier, E1, E2) tuple → no-op.
    const replay = await record({
      idempotencyKey: nextIdempotencyKey("tuple-fresh"),
      tierKey: "tier_1",
    });
    expect(replay.applied).toBe(false);
    expect(replay.tierPaymentId).toBeNull();

    const paymentsAfter = await app.kernel.db
      .select()
      .from(tierPayments)
      .where(eq(tierPayments.facilityId, fx.facilityId));
    expect(paymentsAfter).toHaveLength(paymentsBefore.length);
    expect(await eventCount("billing.tier_payment_recorded.v1")).toBe(recorded);
    // State still as the operator left it — the no-op extended nothing.
    expect((await billingTierState())!.tierExpiresAt.getTime()).toBe(e1.getTime());

    // Restore the real expiry so later tests keep a coherent fixture.
    await app.kernel.db
      .update(facilityTiers)
      .set({ tierExpiresAt: e2 })
      .where(eq(facilityTiers.facilityId, fx.facilityId));
  });

  it("renews from the future expiry and switches tier on the same state row", async () => {
    const before = (await billingTierState())!;
    const outcome = await record({
      idempotencyKey: nextIdempotencyKey("tier-switch"),
      tierKey: "tier_2",
      periods: 2,
    });
    expect(outcome.applied).toBe(true);

    const after = (await billingTierState())!;
    // Same aggregate row, switched tier, extended from the prior expiry.
    expect(after.id).toBe(before.id);
    expect(after.tierExpiresAt.getTime()).toBeGreaterThan(before.tierExpiresAt.getTime());

    const [payment] = await app.kernel.db
      .select()
      .from(tierPayments)
      .where(eq(tierPayments.id, outcome.tierPaymentId!));
    expect(payment?.periodStart.getTime()).toBe(before.tierExpiresAt.getTime());
    // tier_2 price 90,000 × 2 periods.
    expect(payment?.amount).toBe(180_000);

    // Directory mirror follows the switch.
    await waitFor(async () => {
      const [facility] = await app.kernel.db
        .select({ tierRank: facilities.tierRank })
        .from(facilities)
        .where(eq(facilities.id, fx.facilityId));
      return facility?.tierRank === 2 ? facility : undefined;
    });
  });

  it("exposes the admin tier-state view (contract round-trip)", async () => {
    const res = await trpc(
      app,
      "billing.facilityTierState",
      "query",
      { facilityId: fx.facilityId },
      session,
    );
    expect(res.statusCode).toBe(200);
    const body = facilityTierStateOutputSchema.parse(result(res));
    expect(body.tierKey).toBe("tier_2");
    expect(body.payments.length).toBeGreaterThanOrEqual(4);
    expect(body.payments.every((p) => p.gateway === "manual")).toBe(true);
  });
});
