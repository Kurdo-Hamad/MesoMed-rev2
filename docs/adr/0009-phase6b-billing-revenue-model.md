# ADR-0009 — Phase 6b: Billing Revenue Model

**Status:** Accepted
**Phase:** 6b (extends the Phase 6 billing module; does not start Phase 7)
**Builds on:** ADR-0008 (billing/payments, PaymentOrchestrator, webhook
surface), ADR-0003 (kernel/outbox, idempotent handler registry, config
service), ADR-0006 (booking lifecycle events).

## The revenue model (complete)

Every provider — doctor, hospital, laboratory, pharmacy, home nursing,
dental clinic, beauty center — selects exactly one subscription model at
registration:

- **flat_monthly:** a fixed monthly fee plus a fixed per-booking fee on
  every completed platform booking; or
- **commission:** a percentage per completed booking.

Admins set all rates per **category × model** in `billing_rate_config`
(rate kinds: `monthly_fee`, `per_booking_fee`, `commission_pct`); nobody
free-types amounts inline in commands. Tier (1/2/3) remains the Phase 6
ranking mechanism, orthogonal to the subscription model. All providers
must hold a subscription (either model) to be publicly visible — see the
ADR-0008 supersession below. A free trial waives the subscription/monthly
fee ONLY; per-booking charges accrue from day one, including during trial
(global default months + per-provider `trial_ends_at` override, both
config-driven). Per-booking charges are computed on `booking.completed.v1`
only and accrue as provider debt — nothing is charged at booking time and
no patient payment details exist at booking (MM-DEC friction-free booking
is NOT amended this phase). Patient cancellation/no-show charges are BUILT
DORMANT: policy fully stored and settable now, handlers wired and tested,
collection gated by the single global `billing.patient_collection_enabled`
config flag (default false).

## Decisions

### 1. Model the FULL shape, activate only the launch slice

Every schema, enum, event contract and handler in this phase covers the
complete revenue model above. Behavior not active at launch exists as
wired-but-dormant code paths behind config — never as missing code:

- `billing_charges.payer` carries `provider | patient`; only `provider`
  rows are written at launch. The patient path (columns, handlers, gateway
  routing kind `patient_charge`, events) is complete and flag-gated.
- Activating patient collection is ONE config edit
  (`billing.patient_collection_enabled` → true; plus routing rows). The
  gate test flips it in-test against a fake gateway with zero code change.
- Adding a payment gateway is an adapter in `packages/platform` plus
  config rows (`billing.known_gateways` + routing) — proven by a test that
  registers a brand-new id purely via config, shows it fail-closed, then
  works the moment an adapter is injected at the composition-root seam.
- Activating any deferred behavior must never require `ALTER TABLE`.

### 2. The unified charge ledger and its integrity rules

`billing_charges` is the single ledger for everything the platform is
owed: `reason ∈ {commission, per_booking_fee, subscription_fee,
cancellation_fee, no_show_fee}`, `status ∈ {pending, settled, void,
refunded}`. Money is **integer minor units (IQD fils) in bigint columns —
floats are forbidden anywhere money is represented**; commission rates are
integer basis points. Currency is an explicit ISO 4217 column on every row
money appears in.

Idempotency mirrors the Phase 6 tier-payment discipline, enforced at the
database: a global unique `idempotency_key`, a partial unique on
`(booking_id, reason)` for booking-driven charges, and a partial unique on
`(provider_id, period_start)` for subscription fees (both excluding
reversal rows), written with targetless `ON CONFLICT DO NOTHING` — a
duplicate event delivery or a divergent replay under a fresh key is a
silent no-op, never a double charge.

Charge rows are financial facts. Migration 0006 installs triggers
(clinical-tier enforcement depth): the ONLY legal UPDATE is
`pending → settled/void` plus settlement metadata; the monetary identity
of any row (payer, reason, amount, currency, references, key) can never
change; DELETE always raises; the API role holds no DELETE grant on the
ledger. Correcting a settled charge is a NEW reversal row
(`reverses_charge_id`, status `refunded`, at most one per charge) — never
an UPDATE to amount. Events: `billing.charge_recorded.v1`,
`billing.charge_settled.v1`, `billing.charge_voided.v1` (kind `void` |
`refund`) — additive; no existing v1 contract was modified.

### 3. Rounding rule: HALF-UP on the fractional minor unit

Commission math (`packages/domain/billing/money.ts`) computes
`floor((base × basis_points + 5000) / 10000)` on BigInt — half-up
rounding, tie goes up, overflow-safe far beyond any realistic amount.
Chosen over banker's rounding for determinism a paper invoice can
reproduce by hand; recorded here as THE rounding rule for all future
percentage-based money math. Unit-tested including exact ties, sub-tie
fractions and >2^53 intermediate products.

### 4. Commission base: provider-declared booking value (deviation)

A commission percentage needs a base, and nothing in the system carries a
booking price (friction-free booking; no patient payment capture). The
spec's column lists did not name a base, so this phase resolves it:
`provider_billing_config.booking_value_minor` — the provider's declared
standard booking value, REQUIRED when model = commission (DB CHECK +
contract refinement). It is provider data, not a platform rate; rates stay
in `billing_rate_config`. Both the resolved rate AND the base are
snapshotted onto each charge row (`rate_value`, `rate_base_minor`), so
neither a rate edit nor a booking-value edit rewrites history — proven by
the rate-snapshot gate test. When real patient payment capture lands
(future MM-DEC amendment), commission can switch to the actual paid
amount without schema change: the charge computation is a pure domain
function of (base, basis points).

### 5. Trial semantics

`trial_ends_at` (per-provider, admin-settable) overrides the global
default window (`billing.trial` config row, months from
`provider_billing_config.created_at`; missing row = no trial). Trial
suppresses SUBSCRIPTION-FEE accrual only — the booking-completed handler
never consults the trial window. Subscription fees accrue via an
idempotent admin command (`accrueSubscriptionFee`): one UTC calendar month
per call (the ported `addUtcMonths` end-of-month clamping — the single
calendar primitive for every billing window), periods anchored on the
trial end and chained gap-free on the last accrued period. **No cron this
phase** — consistent with ADR-0008's "scheduled lapse belongs with Phase
7's scheduled work"; the Phase 7 pg-boss cron will drive the same command.

### 6. Cancellation/no-show: evaluation always, collection dormant

Billing subscribes to `booking.cancelled.v1` and `booking.no_show.v1`.
Every trigger produces exactly one `billing_policy_evaluations` row per
(booking, trigger) — the idempotency claim for the whole path — recording
the outcome (`no_policy | policy_disabled | within_free_window | fee_zero
| fee_applicable`), the policy snapshot, and the collection flag's value
at evaluation time. The cancellation instant is the booking module's
published `getAppointmentTransitionRef` (`status_changed_at` of a terminal
state), so the evaluation is deterministic under outbox redelivery —
never wall-clock-at-delivery. With the flag off (launch): zero patient
charge rows, zero settled patient charges, zero gateway calls (gate-tested
with a spy gateway). With the flag on: the same handler writes the patient
charge and routes it through the orchestrator by the provider's country ×
`patient_charge` — activation is config only. The policy-evaluation table
uses explicit columns, no jsonb (see decision 7).

### 7. HARD SECURITY RULE: no payment-instrument data, ever

Billing tables store charge facts and the gateway's opaque reference
(`gateway_charge_ref` / `reference`) ONLY — no card/PAN, CVV, IBAN,
account/routing numbers, no tokens beyond the gateway ref, and no column
CAPABLE of holding an instrument: billing tables carry no json/jsonb/bytea
columns at all. Enforced by a schema meta-test
(`instrument-absence.test.ts`) that introspects `information_schema` on
the real migrated schema across ALL billing tables (Phase 6 + 6b) and
fails on instrument vocabulary in column names or free-form payload types.
The table list in that test is load-bearing: new billing tables must be
added to it.

### 8. Supersession of ADR-0008's visibility exemption (doc-only)

ADR-0008 recorded (in its Decision 3, "Subscription visibility gates
account-backed doctors only" — cited by the Phase 6b directive as
"Decision 2"; the exemption lives in one decision regardless of ordinal)
that admin-curated listings without an identity account stay publicly
visible with no subscription. **Permanent policy is now: all providers
must hold a subscription (either model) to be publicly visible.** The
exemption is TRANSITIONAL — it remains operative until provider migration
assigns billing configs to curated listings; the reversal path ADR-0008
already named (backfill subscriptions, drop the `identity_profile_id IS
NULL` escape from the one predicate function) is the planned mechanism.
This phase changes no visibility code (doc-only per the directive);
ADR-0008 carries a corresponding amendment note.

### 9. Authorization and vocabulary notes

- All new commands are role-gated at the kernel (layer a) with ownership
  checks in handlers (layer b): providers (every provider account holds
  the `doctor` role per Phase 2) manage their OWN billing model, policy
  and charge reads; trial overrides, rates, charge lifecycle, accrual and
  the global config knobs are admin-only.
- The billing category vocabulary (`BILLING_CATEGORIES` in contracts)
  mirrors the directory provider types; the assigning command snapshots
  the directory's provider type onto `provider_billing_config.category`
  via the published `provider-refs` query — billing never joins directory
  tables (§3.1). `category` columns are deliberately un-CHECKed text so
  extending the vocabulary is a contracts change, not a migration.
- New typed errors (additive, §3.11): `RATE_NOT_CONFIGURED` and
  `BILLING_MODEL_NOT_CONFIGURED` (both → PRECONDITION_FAILED). A provider
  WITH a model but no active rate fails loudly on the event path (retry →
  dead-letter) — misconfiguration surfaces; it never silently under-bills.
  A provider with NO billing config accrues nothing (the transitional
  state of decision 8).
- New published cross-module read surfaces (§3.1):
  `directory/queries/provider-refs.ts` (provider id/type/country for a
  doctor profile or session user) and
  `booking/queries/appointment-refs.ts` (terminal-transition instant).

## Explicit deferrals (do not build now)

- **Paid ads and featured homepage slots** — entirely out of scope; not
  modeled, not stubbed. A future phase.
- **Live gateway integrations** — `stripe` joins `fib`/`zaincash` as a
  routable, fail-closed, interface-ready id: no SDK dependency, no
  adapter. Each future gateway = one adapter + config rows (proven by the
  extensibility gate test).
- **Patient payment capture at booking** — MM-DEC's friction-free booking
  stands; introducing payment at booking requires a future MM-DEC
  amendment. The dormant patient-collection path and the payer=patient
  ledger shape are ready for it.
- **Accrual/lapse cron** — Phase 7 scheduled work (decision 5).

## Gate evidence

- **Ledger end-to-end through the outbox dispatcher:** real bookings
  driven through the real lifecycle; commission provider accrues the
  rounded percentage with rate + base snapshotted; flat-monthly provider
  accrues the fixed fee; charge events emitted in the handler transaction
  (`charges.test.ts`).
- **Idempotency:** duplicate `booking.completed.v1` delivery → exactly one
  charge row at BOTH layers (processed_events claim erased, ledger unique
  constraints absorb the replay); subscription-fee period replay under the
  same key AND under a fresh key both no-ops (`charges.test.ts`,
  `subscription-fee.test.ts`).
- **Rate-snapshot proof:** rate doubled after a charge exists → historical
  row byte-identical, next charge uses the new rate (`charges.test.ts`).
- **Trial proof:** provider inside the global-default window accrues
  per-booking charges but `trial_waived` on the monthly fee; global-default
  expiry (backdated anchor) and per-provider override expiry both resume
  accrual, periods anchored on the trial end (`subscription-fee.test.ts`).
- **Dormancy proof:** fee-bearing cancellation and no-show with the flag
  off → evaluation rows recorded, ZERO patient charges, ZERO gateway calls
  (spy); flag flipped in-test → same path records AND settles the patient
  charge through the fake gateway, then flips back off cleanly
  (`policy.test.ts`).
- **Gateway extensibility:** "fakepay" registered via config only →
  routable, fail-closed (typed 412) until an adapter is injected, then
  settles; stripe/fib/zaincash routable and fail-closed
  (`gateway-extensibility.test.ts`).
- **Instrument absence:** meta-test green over all 11 billing tables.
- **Ledger immutability at the DB:** settled-row UPDATE (amount or
  status), pending-row amount UPDATE, and any DELETE all raise
  `BILLING_CHARGE_IMMUTABLE` for the table owner (`charges.test.ts`).
- **Boundaries/lint/typecheck/build green; full serialized suite green**
  (Phase 6 baseline of 550 tests not regressed — see the phase gate run).

## Deviations / notes

- `booking_value_minor` (+ its snapshot column) and the explicit
  `currency` column on `provider_cancellation_policy` /
  `billing_policy_evaluations` extend the directive's minimum column
  lists — required by the commission-base resolution (decision 4) and the
  everywhere-explicit-currency rule.
- `billing_charges.patient_profile_id` (identity cross-reference, no FK)
  is part of the full patient-charge shape, null on provider rows.
- `provider_billing_config.tier_id` FKs the Phase 6 `listing_tiers` table
  (nullable): the provider's held tier under the revenue model. The
  operative ranking state remains Phase 6's `facility_tiers`; unifying
  doctor-level tier state is future work, not a 6b concern.
- `subscription_id` on charges references `provider_billing_config` (the
  6b subscription aggregate). Phase 6's doctor `subscriptions` table and
  its visibility events remain untouched and operative.
