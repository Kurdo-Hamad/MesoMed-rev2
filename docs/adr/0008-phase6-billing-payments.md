# ADR-0008 — Phase 6: Billing + Payments

**Status:** Accepted
**Phase:** 6 (MM-PLAN-001 §5) — billing module: per-doctor flat monthly
subscriptions (active/grace_period/inactive), listing tiers with
config-row pricing, idempotent tier payments (both ported uniqueness
constraints), the PaymentOrchestrator (`PaymentGateway` adapter interface,
config-table routing, complete `manual` gateway), the hardened payment
webhook endpoint, and the directory public-visibility rule driven by
billing events.
**Builds on:** ADR-0003 (kernel/outbox, idempotent handler registry,
config service), ADR-0005 (directory visibility recompute path,
denormalized `publicly_visible` / `tier_rank` columns).

## Decisions

### 1. Billing owns its own tier expiry; the directory's copy follows via events

MM-PLAN-001 says "tier payment recording atomically extends
`tier_expires_at` in the same tx", but the `facilities.tier_expires_at`
column belongs to the directory, which billing must never write (§3.1).
Resolution: billing owns a `facility_tiers` table (facility → tier,
`tier_expires_at`), and `applyTierPayment` extends **that** column in the
payment transaction — ledger insert, expiry extension and
`billing.tier_payment_recorded.v1` emission commit or roll back together
(§3.2). The directory's denormalized `facilities.tier_rank` /
`tier_expires_at` pair is updated eventually-consistently by the
directory's own subscriber (`directory.sync-facility-tier`), which also
re-emits the `directory.facility_updated.v1` snapshot so the search read
model follows. The event payload carries `tierRank` so no subscriber ever
reads billing tables.

### 2. Both ported tier-payment idempotency constraints, enforced targetless

`tier_payments` carries the old schema's two unique constraints — the
`idempotency_key` and the `(facility_id, tier_id, period_start,
period_end)` tuple — and the insert uses a targetless `ON CONFLICT DO
NOTHING`, so a violation of EITHER constraint is a documented no-op
(`applied: false`, no extension, no event), never an error. Payment
periods derive from `@mesomed/domain/billing` (`paymentPeriod` composes
the ported `computeNewExpiry` — extend from the current expiry while it is
in the future, else from now, +N UTC calendar months with end-of-month
clamping; the calendar math was not reimplemented). Because a renewal's
`period_start` equals the stored prior expiry exactly, the tuple
constraint deterministically catches re-recordings of an already-covered
period under a fresh key (tested by restoring the state row to a prior
expiry with the ledger intact — the divergence scenario the constraint
guards). Concurrent settlements serialize on a `FOR UPDATE` lock of the
`facility_tiers` row. `subscription_payments` carries the idempotency key
constraint (period tuples are meaningless for a per-doctor flat fee whose
aggregate row is locked on every settlement).

### 3. Subscription visibility gates account-backed doctors only

The public-visibility predicate (still centralized in the directory's
`recomputeProviderVisibility`, exactly where the Phase 3 code planned the
extension) is now: facilities — provider approved AND listing active
(unchanged); doctors — approved AND active AND, **for account-backed
profiles only** (`providers.identity_profile_id` non-null), an
active-or-grace subscription. Admin-curated listings have no identity
account, hence nobody to bill: they stay visible on approved + active,
which also keeps the Phase 3 seed pipeline and directory/search suites
semantically intact. Grace period retains visibility; only the transition
to `inactive` emits `billing.subscription_expired.v1` and hides the
doctor. Reversal path if the business later bills curated listings:
backfill subscriptions and drop the `identity_profile_id IS NULL` escape
from the one predicate function.

The directory mirrors billing state in its own
`providers.subscription_active` column (same single-writer discipline as
`providers.approved`), synced only by its subscribers on
`billing.subscription_activated/expired.v1`. Billing never writes
directory tables; directory never joins billing tables; billing validates
payment targets through the directory's published `facility-refs` /
`doctor-profile-refs` queries (§3.1).

**Gate interpretation:** "visibility flips on subscription events without
directory code changes" is read as: the flip is event-driven data flow —
no directory command, no query change, no deploy. The phase itself ships
the (pre-planned) directory subscribers and the predicate extension;
directory query code is untouched. The gate test drives billing
procedures only and observes the flip through directory reads via the
real outbox dispatcher, in both directions.

### 4. PaymentOrchestrator: adapters behind one interface, routing as config data

`PaymentGateway` (`isConfigured` / `initiatePayment` / `verifyPayment` /
`handleWebhook`) lives in `packages/platform` (§3.8); adapters are wired
only in the composition root and selected per request through the
`billing.payment_routing` config row (country × payment kind → gateway
id, `packages/config` schema — same pattern as country gating, §3.9).
Resolution fails closed with typed `PAYMENT_GATEWAY_NOT_CONFIGURED` for a
missing route, an unregistered adapter, or an unconfigured adapter. The
`manual` gateway is complete: initiation settles synchronously with a
deterministic per-key reference (admin-recorded out-of-band payments),
verification affirms only references it minted, and it has **no webhook
channel** (deliveries answer 404 rather than being silently accepted).
FIB/ZainCash are interface-ready only (§8): their ids are routable in
config ahead of time, but no adapter stubs exist — staging a route to
them keeps failing typed until a real adapter lands. Manual tier-payment
amounts are never typed by the admin: the (tier, country) `tier_prices`
row is authoritative.

### 5. Webhook endpoint: validated, signature-checked, rate-limited, idempotent

`POST /webhooks/payments/:gateway` lives in an encapsulated Fastify scope
with three properties the old codebase lacked (all gate-tested): the body
is validated against a strict Zod envelope before any processing; the
gateway adapter verifies the signature over the **exact raw bytes** (the
scope's content-type parser preserves the string; re-serialized JSON
never verifies) via `handleWebhook`, with 401 for missing/wrong
signatures; and `@fastify/rate-limit` guards the scope (env-tunable
`WEBHOOK_RATE_LIMIT_MAX`/`_WINDOW_MS`), proven to fire 429 without
touching the tRPC surface. Settlement reuses the same idempotent
`applyTierPayment`/`applySubscriptionPayment` commands as admin
recording (`recorded_by = "gateway:<id>"`), so a duplicate delivery
answers 200 `{received: true, applied: false}` — gateways stop retrying,
state provably unchanged. Signature schemes are per-gateway adapter
concerns; the suite proves the contract against an HMAC-SHA256 test
adapter injected through the composition-root seam, since `manual` has no
webhooks and FIB/ZainCash are deferred.

### 6. Events and errors

`billing.subscription_activated.v1` (every settlement, carries
`paidUntil`), `billing.subscription_expired.v1` (only on the transition
to `inactive` — grace is not an integration signal), and
`billing.tier_payment_recorded.v1` (carries the denormalized `tierRank`),
all versioned Zod contracts in `packages/contracts/events/billing.ts`,
emitted via the kernel outbox in the mutating transaction. New typed
error codes (additive, §3.11): `PAYMENT_GATEWAY_NOT_CONFIGURED`
(→ PRECONDITION_FAILED) and `PAYMENT_NOT_SETTLED` (→ BAD_GATEWAY);
misuse of existing state reuses `INVALID_STATUS_TRANSITION` (double
expiry, grace from inactive).

## Deviations / notes

- **`facility_tiers` is a new table** not named in MM-PLAN-001 §5 — it is
  the resolution of the §3.1-vs-atomic-extension conflict in decision 1.
- **No expiry cron.** Lapsing active → grace_period → inactive is an
  admin command in this phase; scheduled lapse (pg-boss cron) belongs
  with Phase 7's scheduled work. Tier expiry needs no cron by design:
  the ported `effectiveTierRank` read rule (expired ⇒ rank 3) already
  degrades expired tiers at read time.
- **Subscription pricing is not a config row yet** (tier prices are).
  The flat monthly subscription amount is supplied by the admin on
  recording; a `billing.subscription_pricing` config row can join §3.9
  when self-serve payment lands with the real gateways.
- **Migration 0005** ends with a hand-written grants tail (the 0004
  `GRANT ON ALL TABLES` was point-in-time); billing tables take ordinary
  least-privilege DML — no clinical-tier restrictions apply.
- Local Windows note: repo-wide `format:check` reports CRLF artifacts on
  files this phase never touched (LF in git blobs, CRLF working tree via
  autocrlf); CI checks out LF and passes. All Phase 6 files verify clean
  locally.

## Gate evidence

- **Idempotency:** duplicate webhook delivery (same signed body) → 200
  `applied:false`, ledger/event counts unchanged; duplicate manual
  recording under the same key → `applied:false`, expiry not extended;
  same period tuple under a different key → `applied:false`
  (`tier-payment.test.ts`, `webhook.test.ts`, `subscription.test.ts`).
- **Visibility flip through the outbox dispatcher with zero directory
  procedure calls:** never-billed account-backed doctor invisible →
  payment → visible in `directory.browseDoctors` → grace keeps visible,
  no expiry event → deactivation hides → fresh payment restores; curated
  doctor unaffected throughout (`subscription.test.ts`); webhook-settled
  subscription drives the same chain (`webhook.test.ts`).
- **Webhook hardening:** 400 on malformed JSON / schema violations /
  unknown extra fields, 401 unsigned / mis-signed / tampered bytes, 404
  unknown / unconfigured / webhook-less gateways, 429 once the window
  budget is spent while tRPC stays open (`webhook.test.ts`).
- **CI:** lint, typecheck, build, and the full serialized suite green —
  550 tests / 63 files across 10 packages (up from 499 at the Phase 5
  gate), including 31 new billing integration tests
  (`apps/api/test/billing/`) plus the payment-period, manual-gateway,
  billing-event-contract and payment-routing unit suites.
