import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { chargesOutputSchema, settleChargeResultSchema } from "@mesomed/contracts";
import { and, billingCharges, domainEvents, eq, processedEvents } from "@mesomed/db";
import { ON_BOOKING_COMPLETED_HANDLER } from "../../src/modules/billing/events/on-booking-completed.js";
import {
  ADMIN,
  buildBillingTestServer,
  completeBooking,
  result,
  seedRevenueFixture,
  trpc,
  waitForBookingCharge,
  COMMISSION_BOOKING_VALUE_MINOR,
  EXPECTED_COMMISSION_MINOR,
  RATE_COMMISSION_BP,
  RATE_PER_BOOKING_FEE_MINOR,
  type RevenueFixture,
} from "./helpers.js";

/**
 * Phase 6b gate: the unified charge ledger, driven end-to-end — real
 * bookings through the real lifecycle, booking.completed.v1 through the
 * real outbox dispatcher, charges accrued per the provider's model with
 * the rate snapshotted, replays provably no-ops, settled rows immutable
 * at the database level.
 */
describe("per-booking charges through the outbox dispatcher", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let fx: RevenueFixture;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBillingTestServer(tdb.connectionString);
    await app.ready();
    fx = await seedRevenueFixture(app);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("a commission provider accrues the rounded percentage of its booking value", async () => {
    const appointmentId = await completeBooking(app, fx.commissionClinic);
    const charge = await waitForBookingCharge(app, appointmentId);

    expect(charge.payer).toBe("provider");
    expect(charge.reason).toBe("commission");
    expect(charge.providerId).toBe(fx.commissionProviderId);
    expect(charge.amountMinor).toBe(EXPECTED_COMMISSION_MINOR);
    expect(charge.currency).toBe("IQD");
    expect(charge.status).toBe("pending");
    // Rate snapshot: the resolved rate travels onto the row.
    expect(charge.rateKind).toBe("commission_pct");
    expect(charge.rateValue).toBe(RATE_COMMISSION_BP);
    expect(charge.rateBaseMinor).toBe(COMMISSION_BOOKING_VALUE_MINOR);

    // charge_recorded emitted in the same transaction.
    const events = await tdb.db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.name, "billing.charge_recorded.v1"),
          eq(domainEvents.aggregateId, charge.id),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      chargeId: charge.id,
      providerId: fx.commissionProviderId,
      reason: "commission",
      amountMinor: EXPECTED_COMMISSION_MINOR,
    });
  });

  it("a flat-monthly provider accrues the fixed per-booking fee", async () => {
    const appointmentId = await completeBooking(app, fx.flatClinic);
    const charge = await waitForBookingCharge(app, appointmentId);

    expect(charge.reason).toBe("per_booking_fee");
    expect(charge.providerId).toBe(fx.flatProviderId);
    expect(charge.amountMinor).toBe(RATE_PER_BOOKING_FEE_MINOR);
    expect(charge.rateKind).toBe("per_booking_fee");
    expect(charge.rateValue).toBe(RATE_PER_BOOKING_FEE_MINOR);
    expect(charge.rateBaseMinor).toBeNull();
  });

  it("duplicate delivery yields exactly one charge row (claim AND ledger constraints)", async () => {
    const appointmentId = await completeBooking(app, fx.commissionClinic);
    const charge = await waitForBookingCharge(app, appointmentId);

    const [completedEvent] = await tdb.db
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.name, "booking.completed.v1"),
          eq(domainEvents.aggregateId, appointmentId),
        ),
      );
    expect(completedEvent).toBeDefined();

    // Layer 1: the processed_events claim absorbs redelivery.
    await app.kernel.dispatcher.redeliver(completedEvent!.id);

    // Layer 2: with the claim erased, the ledger's unique constraints
    // (idempotency key; booking/reason tuple) absorb it — no second row,
    // no second event.
    await tdb.db
      .delete(processedEvents)
      .where(
        and(
          eq(processedEvents.eventId, completedEvent!.id),
          eq(processedEvents.handler, ON_BOOKING_COMPLETED_HANDLER),
        ),
      );
    await app.kernel.dispatcher.redeliver(completedEvent!.id);

    const charges = await tdb.db
      .select()
      .from(billingCharges)
      .where(eq(billingCharges.bookingId, appointmentId));
    expect(charges).toHaveLength(1);

    const recordedEvents = await tdb.db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.name, "billing.charge_recorded.v1"),
          eq(domainEvents.aggregateId, charge.id),
        ),
      );
    expect(recordedEvents).toHaveLength(1);
  });

  it("rate-snapshot proof: changing the rate never rewrites history; the next charge uses it", async () => {
    const beforeAppointment = await completeBooking(app, fx.commissionClinic);
    const before = await waitForBookingCharge(app, beforeAppointment);
    expect(before.amountMinor).toBe(EXPECTED_COMMISSION_MINOR);

    // Admin doubles the commission rate to 15%.
    const res = await trpc(
      app,
      "billing.setBillingRate",
      "mutation",
      {
        category: "doctor",
        model: "commission",
        rateKind: "commission_pct",
        value: 1_500,
        currency: "IQD",
      },
      ADMIN,
    );
    expect(res.statusCode).toBe(200);

    // Historical charge: byte-for-byte unchanged.
    const [historical] = await tdb.db
      .select()
      .from(billingCharges)
      .where(eq(billingCharges.id, before.id));
    expect(historical!.amountMinor).toBe(EXPECTED_COMMISSION_MINOR);
    expect(historical!.rateValue).toBe(RATE_COMMISSION_BP);

    // Next charge: the new rate, snapshotted anew. 25,000,000 × 15% = 3,750,000.
    const afterAppointment = await completeBooking(app, fx.commissionClinic);
    const after = await waitForBookingCharge(app, afterAppointment);
    expect(after.amountMinor).toBe(3_750_000);
    expect(after.rateValue).toBe(1_500);

    // Restore for later tests.
    await trpc(
      app,
      "billing.setBillingRate",
      "mutation",
      {
        category: "doctor",
        model: "commission",
        rateKind: "commission_pct",
        value: RATE_COMMISSION_BP,
        currency: "IQD",
      },
      ADMIN,
    );
  });

  it("myCharges binds to the session's own provider (layer b); admins read any ledger", async () => {
    const own = await trpc(
      app,
      "billing.myCharges",
      "query",
      { limit: 50 },
      {
        roles: "doctor",
        user: fx.commissionClinic.doctorUserId,
      },
    );
    expect(own.statusCode).toBe(200);
    const ownCharges = chargesOutputSchema.parse(result(own)).charges;
    expect(ownCharges.length).toBeGreaterThan(0);
    expect(ownCharges.every((c) => c.providerId === fx.commissionProviderId)).toBe(true);

    // A doctor session with no provider sees an empty ledger, not errors.
    const stranger = await trpc(
      app,
      "billing.myCharges",
      "query",
      { limit: 50 },
      {
        roles: "doctor",
        user: "doctor-with-no-provider",
      },
    );
    expect(stranger.statusCode).toBe(200);
    expect(chargesOutputSchema.parse(result(stranger)).charges).toHaveLength(0);

    const admin = await trpc(
      app,
      "billing.providerCharges",
      "query",
      { providerId: fx.flatProviderId, limit: 50 },
      ADMIN,
    );
    expect(admin.statusCode).toBe(200);
    const adminCharges = chargesOutputSchema.parse(result(admin)).charges;
    expect(adminCharges.every((c) => c.providerId === fx.flatProviderId)).toBe(true);
  });

  it("settles a pending charge through the orchestrator and emits charge_settled", async () => {
    const appointmentId = await completeBooking(app, fx.flatClinic);
    const charge = await waitForBookingCharge(app, appointmentId);

    // Route IQ provider-charge settlements to the manual gateway.
    const routing = await trpc(
      app,
      "billing.setPaymentRouting",
      "mutation",
      { countryCode: "IQ", kind: "provider_charge", gateway: "manual" },
      ADMIN,
    );
    expect(routing.statusCode).toBe(200);

    const res = await trpc(
      app,
      "billing.settleCharge",
      "mutation",
      { chargeId: charge.id },
      { ...ADMIN, country: "IQ" },
    );
    expect(res.statusCode).toBe(200);
    const body = settleChargeResultSchema.parse(result(res));
    expect(body.status).toBe("settled");
    expect(body.gatewayId).toBe("manual");

    const [settled] = await tdb.db
      .select()
      .from(billingCharges)
      .where(eq(billingCharges.id, charge.id));
    expect(settled!.status).toBe("settled");
    expect(settled!.settledAt).not.toBeNull();
    expect(settled!.gatewayChargeRef).not.toBeNull();

    const events = await tdb.db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.name, "billing.charge_settled.v1"),
          eq(domainEvents.aggregateId, charge.id),
        ),
      );
    expect(events).toHaveLength(1);

    // Settling twice is a typed conflict, not a double settlement.
    const again = await trpc(
      app,
      "billing.settleCharge",
      "mutation",
      { chargeId: charge.id },
      { ...ADMIN, country: "IQ" },
    );
    expect(again.statusCode).toBe(409);
  });

  it("void flips a pending charge; refund reverses a settled one as a NEW row", async () => {
    // Void path.
    const voidAppointment = await completeBooking(app, fx.flatClinic);
    const pendingCharge = await waitForBookingCharge(app, voidAppointment);
    const voided = await trpc(
      app,
      "billing.voidCharge",
      "mutation",
      { chargeId: pendingCharge.id },
      ADMIN,
    );
    expect(voided.statusCode).toBe(200);
    expect(result<{ status: string }>(voided).status).toBe("void");

    // Refund path: settle first, then refund.
    const refundAppointment = await completeBooking(app, fx.flatClinic);
    const charge = await waitForBookingCharge(app, refundAppointment);
    await trpc(
      app,
      "billing.settleCharge",
      "mutation",
      { chargeId: charge.id },
      {
        ...ADMIN,
        country: "IQ",
      },
    );

    const refunded = await trpc(
      app,
      "billing.refundCharge",
      "mutation",
      { chargeId: charge.id },
      ADMIN,
    );
    expect(refunded.statusCode).toBe(200);
    const { reversalChargeId } = result<{ reversalChargeId: string }>(refunded);

    // The original settled row is untouched; the reversal is a new row.
    const [original] = await tdb.db
      .select()
      .from(billingCharges)
      .where(eq(billingCharges.id, charge.id));
    expect(original!.status).toBe("settled");
    expect(original!.amountMinor).toBe(charge.amountMinor);

    const [reversal] = await tdb.db
      .select()
      .from(billingCharges)
      .where(eq(billingCharges.id, reversalChargeId));
    expect(reversal!.status).toBe("refunded");
    expect(reversal!.reversesChargeId).toBe(charge.id);
    expect(reversal!.amountMinor).toBe(charge.amountMinor);

    // A second refund of the same charge is a typed conflict.
    const again = await trpc(
      app,
      "billing.refundCharge",
      "mutation",
      { chargeId: charge.id },
      ADMIN,
    );
    expect(again.statusCode).toBe(409);

    // Voiding or re-settling the refunded-through charge stays illegal.
    const voidSettled = await trpc(
      app,
      "billing.voidCharge",
      "mutation",
      { chargeId: charge.id },
      ADMIN,
    );
    expect(voidSettled.statusCode).toBe(409);
  });

  it("DB-level immutability: settled rows reject UPDATEs to amount; DELETEs always reject", async () => {
    const [settled] = await tdb.db
      .select({ id: billingCharges.id })
      .from(billingCharges)
      .where(eq(billingCharges.status, "settled"))
      .limit(1);
    expect(settled).toBeDefined();

    await expect(
      tdb.pool.query("update billing_charges set amount_minor = 1 where id = $1", [settled!.id]),
    ).rejects.toThrow(/BILLING_CHARGE_IMMUTABLE/);

    await expect(
      tdb.pool.query("update billing_charges set status = 'pending' where id = $1", [settled!.id]),
    ).rejects.toThrow(/BILLING_CHARGE_IMMUTABLE/);

    await expect(
      tdb.pool.query("delete from billing_charges where id = $1", [settled!.id]),
    ).rejects.toThrow(/BILLING_CHARGE_IMMUTABLE/);

    // Even a pending row's monetary identity is frozen.
    const [pending] = await tdb.db
      .select({ id: billingCharges.id })
      .from(billingCharges)
      .where(eq(billingCharges.status, "pending"))
      .limit(1);
    expect(pending).toBeDefined();
    await expect(
      tdb.pool.query("update billing_charges set amount_minor = 999 where id = $1", [pending!.id]),
    ).rejects.toThrow(/BILLING_CHARGE_IMMUTABLE/);
  });
});
