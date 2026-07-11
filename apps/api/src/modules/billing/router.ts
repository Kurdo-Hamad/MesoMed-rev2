/**
 * Billing module tRPC surface (MM-PLAN-001 §5 Phase 6). Every mutation is
 * role-gated at the kernel (§3.6 layer a); `mySubscription` binds to the
 * session's own doctor profile (layer b). Manual payments run through the
 * PaymentOrchestrator like any gateway: routing config picks the adapter,
 * the adapter settles, and settlement is applied in one transaction with
 * the outbox event (§3.2).
 *
 * Role matrix:
 *   listTiers                  public (pricing is public marketing data)
 *   mySubscription             doctor (own profile only)
 *   upsertListingTier          admin
 *   setTierPrice               admin
 *   setPaymentRouting          admin
 *   recordTierPayment          admin (manual, admin-recorded)
 *   recordSubscriptionPayment  admin (manual, admin-recorded)
 *   expireSubscription         admin
 *   facilityTierState          admin
 */
import {
  expireSubscriptionInputSchema,
  expireSubscriptionResultSchema,
  facilityTierStateInputSchema,
  facilityTierStateOutputSchema,
  listTiersOutputSchema,
  mySubscriptionOutputSchema,
  recordSubscriptionPaymentInputSchema,
  recordSubscriptionPaymentResultSchema,
  recordTierPaymentInputSchema,
  recordTierPaymentResultSchema,
  setPaymentRoutingInputSchema,
  setPaymentRoutingResultSchema,
  setTierPriceInputSchema,
  setTierPriceResultSchema,
  upsertListingTierInputSchema,
  upsertListingTierResultSchema,
} from "@mesomed/contracts/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import { roleProcedure } from "../../kernel/authz.js";
import { AppError } from "../../kernel/errors.js";
import { publicProcedure, router } from "../../kernel/trpc.js";
import { getDoctorProfileIdForUser } from "../directory/queries/doctor-profile-refs.js";
import { setPaymentRouting, setTierPrice, upsertListingTier } from "./commands/tier-admin.js";
import { applyTierPayment } from "./commands/tier-payment.js";
import { applySubscriptionPayment, expireSubscription } from "./commands/subscription.js";
import { getSubscriptionForDoctor } from "./queries/subscription-status.js";
import { getFacilityTierState, listTiers } from "./queries/tier-state.js";
import { resolveGateway, type PaymentGatewayRegistry } from "./shared.js";

export interface BillingRouterDeps {
  gateways: PaymentGatewayRegistry;
}

export function createBillingRouter(deps: BillingRouterDeps) {
  return router({
    // ── Public ─────────────────────────────────────────────────────────
    listTiers: publicProcedure
      .output(listTiersOutputSchema)
      .query(async ({ ctx }) => ({ tiers: await listTiers(ctx.db, ctx.country) })),

    // ── Doctor (layer b: own profile only) ─────────────────────────────
    mySubscription: roleProcedure("doctor")
      .output(mySubscriptionOutputSchema)
      .query(async ({ ctx }) => {
        const doctorProfileId = await getDoctorProfileIdForUser(ctx.db, ctx.session.userId);
        if (doctorProfileId === null) return { subscription: null };
        return { subscription: await getSubscriptionForDoctor(ctx.db, doctorProfileId) };
      }),

    // ── Admin: tier taxonomy / pricing / routing (§3.9 data-over-code) ──
    upsertListingTier: roleProcedure("admin")
      .input(upsertListingTierInputSchema)
      .output(upsertListingTierResultSchema)
      .mutation(({ ctx, input }) => ctx.db.transaction((tx) => upsertListingTier(tx, input))),

    setTierPrice: roleProcedure("admin")
      .input(setTierPriceInputSchema)
      .output(setTierPriceResultSchema)
      .mutation(({ ctx, input }) => ctx.db.transaction((tx) => setTierPrice(tx, input))),

    setPaymentRouting: roleProcedure("admin")
      .input(setPaymentRoutingInputSchema)
      .output(setPaymentRoutingResultSchema)
      .mutation(async ({ ctx, input }) => {
        await setPaymentRouting(ctx.config, deps.gateways, input);
        return { ok: true as const };
      }),

    // ── Admin: manual payment recording via the orchestrator ───────────
    recordTierPayment: roleProcedure("admin")
      .input(recordTierPaymentInputSchema)
      .output(recordTierPaymentResultSchema)
      .mutation(async ({ ctx, input }) => {
        // Price is config data (§3.9): the admin never types an amount for
        // tier payments — the (tier, country) price row is authoritative.
        const tiers = await listTiers(ctx.db, ctx.country);
        const tier = tiers.find((t) => t.key === input.tierKey);
        if (!tier?.price) {
          throw new AppError(
            ErrorCode.VALIDATION,
            `No active price for tier "${input.tierKey}" in ${ctx.country.toUpperCase()}`,
          );
        }
        const amount = tier.price.amount * input.periods;
        const currency = tier.price.currency;

        const gateway = await resolveGateway(
          ctx.config,
          deps.gateways,
          ctx.country,
          "tier_payment",
        );
        const initiation = await gateway.initiatePayment({
          idempotencyKey: input.idempotencyKey,
          kind: "tier_payment",
          amount,
          currency,
          description: `Listing tier ${input.tierKey} × ${input.periods} month(s)`,
        });
        if (initiation.status !== "settled") {
          throw new AppError(
            ErrorCode.PAYMENT_NOT_SETTLED,
            `Gateway "${gateway.id}" did not settle the payment`,
          );
        }

        return ctx.db.transaction((tx) =>
          applyTierPayment(tx, ctx.outbox, {
            idempotencyKey: input.idempotencyKey,
            facilityId: input.facilityId,
            tierKey: input.tierKey,
            periods: input.periods,
            amount,
            currency,
            gateway: gateway.id,
            reference: initiation.reference,
            recordedBy: ctx.session.userId,
          }),
        );
      }),

    recordSubscriptionPayment: roleProcedure("admin")
      .input(recordSubscriptionPaymentInputSchema)
      .output(recordSubscriptionPaymentResultSchema)
      .mutation(async ({ ctx, input }) => {
        const gateway = await resolveGateway(
          ctx.config,
          deps.gateways,
          ctx.country,
          "subscription",
        );
        const initiation = await gateway.initiatePayment({
          idempotencyKey: input.idempotencyKey,
          kind: "subscription",
          amount: input.amount,
          currency: input.currency,
          description: `Doctor subscription × ${input.periods} month(s)`,
        });
        if (initiation.status !== "settled") {
          throw new AppError(
            ErrorCode.PAYMENT_NOT_SETTLED,
            `Gateway "${gateway.id}" did not settle the payment`,
          );
        }

        return ctx.db.transaction((tx) =>
          applySubscriptionPayment(tx, ctx.outbox, {
            idempotencyKey: input.idempotencyKey,
            doctorProfileId: input.doctorProfileId,
            periods: input.periods,
            amount: input.amount,
            currency: input.currency,
            gateway: gateway.id,
            reference: initiation.reference,
            recordedBy: ctx.session.userId,
          }),
        );
      }),

    expireSubscription: roleProcedure("admin")
      .input(expireSubscriptionInputSchema)
      .output(expireSubscriptionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => expireSubscription(tx, ctx.outbox, input)),
      ),

    facilityTierState: roleProcedure("admin")
      .input(facilityTierStateInputSchema)
      .output(facilityTierStateOutputSchema)
      .query(({ ctx, input }) => getFacilityTierState(ctx.db, input.facilityId)),
  });
}
