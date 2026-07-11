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
  accrueSubscriptionFeeInputSchema,
  accrueSubscriptionFeeResultSchema,
  chargesOutputSchema,
  expireSubscriptionInputSchema,
  expireSubscriptionResultSchema,
  facilityTierStateInputSchema,
  facilityTierStateOutputSchema,
  listBillingRatesInputSchema,
  listBillingRatesOutputSchema,
  listTiersOutputSchema,
  myBillingConfigOutputSchema,
  myCancellationPolicyOutputSchema,
  myChargesInputSchema,
  mySubscriptionOutputSchema,
  providerBillingConfigInputSchema,
  providerChargesInputSchema,
  recordSubscriptionPaymentInputSchema,
  recordSubscriptionPaymentResultSchema,
  recordTierPaymentInputSchema,
  recordTierPaymentResultSchema,
  refundChargeInputSchema,
  refundChargeResultSchema,
  registerPaymentGatewayInputSchema,
  registerPaymentGatewayResultSchema,
  setBillingRateInputSchema,
  setBillingRateResultSchema,
  setCancellationPolicyInputSchema,
  setCancellationPolicyResultSchema,
  setPatientCollectionEnabledInputSchema,
  setPatientCollectionEnabledResultSchema,
  setPaymentRoutingInputSchema,
  setPaymentRoutingResultSchema,
  setProviderBillingModelInputSchema,
  setProviderBillingModelResultSchema,
  setTierPriceInputSchema,
  setTierPriceResultSchema,
  setTrialDefaultInputSchema,
  setTrialDefaultResultSchema,
  settleChargeInputSchema,
  settleChargeResultSchema,
  upsertListingTierInputSchema,
  upsertListingTierResultSchema,
  voidChargeInputSchema,
  voidChargeResultSchema,
} from "@mesomed/contracts/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  billingTrialSchema,
  knownGatewaysSchema,
  patientCollectionSchema,
  resolveKnownGatewayIds,
  BILLING_TRIAL_CONFIG_KEY,
  KNOWN_GATEWAYS_CONFIG_KEY,
  PATIENT_COLLECTION_CONFIG_KEY,
} from "@mesomed/config";
import { billingCharges, eq } from "@mesomed/db";
import { roleProcedure } from "../../kernel/authz.js";
import { AppError } from "../../kernel/errors.js";
import { publicProcedure, router } from "../../kernel/trpc.js";
import { getDoctorProfileIdForUser } from "../directory/queries/doctor-profile-refs.js";
import { getProviderRefForUser } from "../directory/queries/provider-refs.js";
import { getCancellationPolicy, setCancellationPolicy } from "./commands/cancellation-policy.js";
import {
  accrueSubscriptionFee,
  refundCharge,
  settleCharge,
  voidCharge,
} from "./commands/charges.js";
import {
  getProviderBillingConfig,
  setProviderBillingModel,
} from "./commands/provider-billing-config.js";
import { listBillingRates, setBillingRate } from "./commands/rate-config.js";
import { setPaymentRouting, setTierPrice, upsertListingTier } from "./commands/tier-admin.js";
import { applyTierPayment } from "./commands/tier-payment.js";
import { applySubscriptionPayment, expireSubscription } from "./commands/subscription.js";
import { listChargesForProvider } from "./queries/charges.js";
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

    // ═══════════════════════════════════════════════════════════════════
    // Phase 6b — revenue model. Role matrix:
    //   setBillingRate / listBillingRates          admin (rates are data, §3.9)
    //   setProviderBillingModel                    doctor (own, no trial override) / admin (any)
    //   myBillingConfig                            doctor (own)
    //   providerBillingConfig                      admin
    //   setCancellationPolicy                      doctor (own) / admin (any)
    //   myCancellationPolicy                       doctor (own)
    //   myCharges                                  doctor (own)
    //   providerCharges                            admin
    //   settleCharge / voidCharge / refundCharge   admin
    //   accrueSubscriptionFee                      admin (Phase 7 cron later)
    //   setTrialDefault / setPatientCollection /
    //   registerPaymentGateway                     admin (config rows, §3.9)
    // ═══════════════════════════════════════════════════════════════════

    setBillingRate: roleProcedure("admin")
      .input(setBillingRateInputSchema)
      .output(setBillingRateResultSchema)
      .mutation(({ ctx, input }) => ctx.db.transaction((tx) => setBillingRate(tx, input))),

    listBillingRates: roleProcedure("admin")
      .input(listBillingRatesInputSchema)
      .output(listBillingRatesOutputSchema)
      .query(async ({ ctx, input }) => ({ rates: await listBillingRates(ctx.db, input) })),

    setProviderBillingModel: roleProcedure("doctor", "admin")
      .input(setProviderBillingModelInputSchema)
      .output(setProviderBillingModelResultSchema)
      .mutation(async ({ ctx, input }) => {
        const isAdmin = ctx.session.roles.includes("admin");
        // Layer b (§3.6): a provider selects a model for ITSELF only, and
        // never sets its own trial override — that knob is admin-only.
        let providerId = input.providerId;
        if (!isAdmin) {
          if (input.trialEndsAt !== undefined) {
            throw new AppError(ErrorCode.FORBIDDEN, "Only admins set trial overrides");
          }
          const own = await getProviderRefForUser(ctx.db, ctx.session.userId);
          if (!own || (providerId !== undefined && providerId !== own.providerId)) {
            throw new AppError(ErrorCode.FORBIDDEN, "Providers manage their own billing model");
          }
          providerId = own.providerId;
        }
        if (providerId === undefined) {
          throw new AppError(ErrorCode.VALIDATION, "providerId is required for admin calls");
        }
        const resolved = providerId;
        return ctx.db.transaction((tx) =>
          setProviderBillingModel(tx, { ...input, providerId: resolved }),
        );
      }),

    myBillingConfig: roleProcedure("doctor")
      .output(myBillingConfigOutputSchema)
      .query(async ({ ctx }) => {
        const own = await getProviderRefForUser(ctx.db, ctx.session.userId);
        if (!own) return { config: null };
        return { config: await getProviderBillingConfig(ctx.db, ctx.config, own.providerId) };
      }),

    providerBillingConfig: roleProcedure("admin")
      .input(providerBillingConfigInputSchema)
      .output(myBillingConfigOutputSchema)
      .query(async ({ ctx, input }) => ({
        config: await getProviderBillingConfig(ctx.db, ctx.config, input.providerId),
      })),

    setCancellationPolicy: roleProcedure("doctor", "admin")
      .input(setCancellationPolicyInputSchema)
      .output(setCancellationPolicyResultSchema)
      .mutation(async ({ ctx, input }) => {
        const isAdmin = ctx.session.roles.includes("admin");
        let providerId = input.providerId;
        if (!isAdmin) {
          const own = await getProviderRefForUser(ctx.db, ctx.session.userId);
          if (!own || (providerId !== undefined && providerId !== own.providerId)) {
            throw new AppError(ErrorCode.FORBIDDEN, "Providers manage their own policy");
          }
          providerId = own.providerId;
        }
        if (providerId === undefined) {
          throw new AppError(ErrorCode.VALIDATION, "providerId is required for admin calls");
        }
        const resolved = providerId;
        return ctx.db.transaction((tx) =>
          setCancellationPolicy(tx, { ...input, providerId: resolved }),
        );
      }),

    myCancellationPolicy: roleProcedure("doctor")
      .output(myCancellationPolicyOutputSchema)
      .query(async ({ ctx }) => {
        const own = await getProviderRefForUser(ctx.db, ctx.session.userId);
        if (!own) return { policy: null };
        return { policy: await getCancellationPolicy(ctx.db, own.providerId) };
      }),

    myCharges: roleProcedure("doctor")
      .input(myChargesInputSchema)
      .output(chargesOutputSchema)
      .query(async ({ ctx, input }) => {
        const own = await getProviderRefForUser(ctx.db, ctx.session.userId);
        if (!own) return { charges: [] };
        return { charges: await listChargesForProvider(ctx.db, own.providerId, input.limit) };
      }),

    providerCharges: roleProcedure("admin")
      .input(providerChargesInputSchema)
      .output(chargesOutputSchema)
      .query(async ({ ctx, input }) => ({
        charges: await listChargesForProvider(ctx.db, input.providerId, input.limit),
      })),

    // ── Charge lifecycle (admin). Settlement runs through the same
    // PaymentOrchestrator as every Phase 6 payment: routing config picks
    // the gateway for (country, provider_charge), the gateway settles,
    // then status flips in one tx with the outbox event (§3.2). ──────────
    settleCharge: roleProcedure("admin")
      .input(settleChargeInputSchema)
      .output(settleChargeResultSchema)
      .mutation(async ({ ctx, input }) => {
        const [charge] = await ctx.db
          .select({
            id: billingCharges.id,
            status: billingCharges.status,
            amountMinor: billingCharges.amountMinor,
            currency: billingCharges.currency,
            payer: billingCharges.payer,
          })
          .from(billingCharges)
          .where(eq(billingCharges.id, input.chargeId));
        if (!charge) throw new AppError(ErrorCode.NOT_FOUND, `Unknown charge "${input.chargeId}"`);
        if (charge.status !== "pending") {
          throw new AppError(
            ErrorCode.INVALID_STATUS_TRANSITION,
            `Cannot settle a ${charge.status} charge`,
          );
        }

        const gateway = await resolveGateway(
          ctx.config,
          deps.gateways,
          ctx.country,
          charge.payer === "patient" ? "patient_charge" : "provider_charge",
        );
        const initiation = await gateway.initiatePayment({
          idempotencyKey: `settle:${charge.id}`,
          kind: charge.payer === "patient" ? "patient_charge" : "provider_charge",
          amount: charge.amountMinor,
          currency: charge.currency,
          description: `Charge ${charge.id} settlement`,
        });
        if (initiation.status !== "settled") {
          throw new AppError(
            ErrorCode.PAYMENT_NOT_SETTLED,
            `Gateway "${gateway.id}" did not settle the charge`,
          );
        }

        const result = await ctx.db.transaction((tx) =>
          settleCharge(tx, ctx.outbox, {
            chargeId: charge.id,
            gatewayId: gateway.id,
            gatewayChargeRef: initiation.reference,
          }),
        );
        return { ...result, gatewayId: gateway.id, gatewayChargeRef: initiation.reference };
      }),

    voidCharge: roleProcedure("admin")
      .input(voidChargeInputSchema)
      .output(voidChargeResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => voidCharge(tx, ctx.outbox, input.chargeId)),
      ),

    refundCharge: roleProcedure("admin")
      .input(refundChargeInputSchema)
      .output(refundChargeResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => refundCharge(tx, ctx.outbox, input.chargeId)),
      ),

    accrueSubscriptionFee: roleProcedure("admin")
      .input(accrueSubscriptionFeeInputSchema)
      .output(accrueSubscriptionFeeResultSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.db.transaction((tx) =>
          accrueSubscriptionFee(tx, ctx.outbox, ctx.config, input.providerId),
        );
        return {
          outcome: result.outcome,
          chargeId: result.chargeId,
          periodStart: result.periodStart?.toISOString() ?? null,
          periodEnd: result.periodEnd?.toISOString() ?? null,
        };
      }),

    // ── Global billing knobs: config rows managed via commands (§3.9) ──
    setTrialDefault: roleProcedure("admin")
      .input(setTrialDefaultInputSchema)
      .output(setTrialDefaultResultSchema)
      .mutation(async ({ ctx, input }) => {
        await ctx.config.set(billingTrialSchema, BILLING_TRIAL_CONFIG_KEY, {
          defaultMonths: input.months,
        });
        return { ok: true as const };
      }),

    setPatientCollectionEnabled: roleProcedure("admin")
      .input(setPatientCollectionEnabledInputSchema)
      .output(setPatientCollectionEnabledResultSchema)
      .mutation(async ({ ctx, input }) => {
        await ctx.config.set(patientCollectionSchema, PATIENT_COLLECTION_CONFIG_KEY, {
          enabled: input.enabled,
        });
        return { ok: true as const };
      }),

    registerPaymentGateway: roleProcedure("admin")
      .input(registerPaymentGatewayInputSchema)
      .output(registerPaymentGatewayResultSchema)
      .mutation(async ({ ctx, input }) => {
        const current = await resolveKnownGatewayIds(ctx.config);
        const next = [...new Set([...current, input.gateway])];
        await ctx.config.set(knownGatewaysSchema, KNOWN_GATEWAYS_CONFIG_KEY, next);
        return { gateways: next };
      }),
  });
}
