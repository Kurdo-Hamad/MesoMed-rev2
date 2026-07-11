# ADR-0011 — Phase 7: Communication + AI

**Status:** Accepted
**Phase:** 7 (Weeks 16–18 per MM-PLAN-001 §5)
**Builds on:** ADR-0003 (kernel/outbox, idempotent handler registry, config
service), ADR-0004 (identity, WhatsApp-OTP mock adapter), ADR-0006 (booking
lifecycle events), ADR-0007 (clinical, prescription events with no
subscriber), ADR-0008/0009 (billing subscription/expiry events), ADR-0010
(prescription-issued event, no subscriber until this phase).
**MM-DEC:** implements §6 (Notifications) and §8 (OTP Delivery
Implementation) of MM-DEC-Authentication-and-Identity-Strategy-Locked-rev02
exactly — no deviation from the locked channel order or OTP semantics.

## Scope (complete)

- **Communication module** (`apps/api/src/modules/communication/`):
  event-driven notification dispatch subscribing to
  `booking.{booked,rescheduled,cancelled}.v1`,
  `billing.subscription_{activated,expired}.v1`, and
  `clinical.prescription_issued.v1`; a channel-preference-aware delivery
  planner (`shared.ts`); trilingual templates (`templates.ts`, en/ar/ckb);
  a poll-based sender (`sender.ts`) with retry/backoff and inline
  WhatsApp→SMS fallback; a next-day reminder cron (`reminders.ts`) over a
  new `(status, starts_at)` booking index; a per-user tRPC router
  (device-token registration, channel preferences).
- **AI module** (`apps/api/src/modules/ai/`): `ai.triageSymptoms`, a
  public, rate-limited port of the Phase-6-deferred symptom-triage
  pipeline behind the `AiGateway` interface — deterministic red-flag
  pre-screen, model call, DB-whitelist intersection, deterministic
  keyword fallback, in that order, with per-caller and global token-bucket
  limits.
- **Real vendor adapters** (`packages/platform/`): Meta WhatsApp Cloud API,
  Twilio SMS, Expo Push, Resend email, Anthropic (Claude Haiku) — each
  behind the existing adapter interfaces from Phase 2, each shipping
  alongside its Phase-2-vintage mock, selected at the composition root
  per-channel by credential presence.
- **Abuse-control guardrails** (`kernel/abuse.ts`, shared by OTP send and
  the notification sender): channel kill-switch, destination-country
  allowlist, daily channel budget, per-scope send-rate limit, velocity
  anomaly detection — all fail-closed, all typed `AppError`, all
  config-driven (`@mesomed/config`).
- **PII discipline** (`kernel/redaction.ts`, `kernel/metrics.ts`): pino
  field-name redaction to `MAX_DEPTH = 5`; a channel-mix OTel counter
  recorded per send outcome (`sent | failed | denied`) with no PII in its
  labels.
- **Mock→real production guardrail** (`apps/api/src/app.ts`): boot-time
  refusal in `NODE_ENV=production` if any of the seven adapters
  (identity OTP whatsapp/sms, email, communication whatsapp/sms/push, AI
  gateway) still resolves to its mock.

## Decisions

### 1. Real-vs-mock resolution is per-channel, never partial

Each of the five vendor integrations (WhatsApp, SMS, push, email, AI) is
wired to its real adapter only when **that channel's own** full credential
set is present in env (`resolveAdapters` in `app.ts`); every other channel
independently falls back to its mock. There is no single "live mode" flag —
a deployment can run real WhatsApp with a mocked AI gateway, for instance,
during staged rollout. `BuildServerOverrides` gained `notifyChannels` and
`pushChannel` (mirroring the existing `emailChannel`/`aiGateway`/
`otpChannels` seams) so tests inject fakes at the same composition-root
seam production credentials flow through — no parallel test-only wiring
path (MM-QA-001 F-05).

### 2. Mock→real production guardrail: boot-time refusal, not runtime warning

A mock adapter silently "delivering" in production is a worse failure mode
than a boot crash: no OTP reaches a patient, no charge notice reaches a
provider, nothing looks broken from the outside. `assertNoMockAdaptersInProduction`
runs in `buildServer` before the Fastify app, the DB pool, or the outbox/
scheduler are constructed (before any I/O), checks all seven adapter slots
via `isMockAdapter()` (existing Phase-2 marker convention), and throws
naming the specific unconfigured adapter. Proven by
`apps/api/test/mock-production-guard.test.ts`: missing credentials reject
naming the mock; a full set of (fake) credentials boots past the guard.

### 3. WhatsApp→SMS fallback is inline in the sender, not a re-planned row

The notification sender mirrors OTP's WhatsApp-first/SMS-fallback order
(MM-DEC rev02 §8), but implements it by retrying the SAME `notification_log`
row against the SMS channel on WhatsApp failure and updating that row's
`channel` column to `"sms"` before marking it sent — never inserting a
second row. This keeps one row per notification with an accurate audit
trail of which channel actually delivered, and keeps `dedupeKey` uniqueness
meaningful (a re-plan under the same key would collide, not fall back).

### 4. Notification planning defers name/locale binding to send-plan time

`planNotification` takes `buildParams: (locale) => Record<string, string>`,
not a precomputed params object. Event handlers (which don't yet know the
patient's locale) pass a closure; `planNotification` resolves the delivery
plan (which determines the patient's locale from
`user_channel_preferences.locale`, default ckb) FIRST, then calls the
closure. This prevents a class of bug where a trilingual name is picked in
the wrong language before the recipient's actual locale is known — e.g. an
English doctor name paired with a Kurdish-language template body.

### 5. PII posture: notification tables are the sanctioned storage, not the events

Every subscriber consumes its triggering event **id-only** and re-reads any
display data (doctor name, location name, patient contact) via published
cross-module queries at plan time — never copies PII out of an event
payload. `notification_log.destination` and `.paramsJson` are the ONLY
tables in the communication module permitted to hold PII, explicitly
documented in schema comments as **crypto-shred scope, 12–24 month
retention** (this ADR is the schema comments' citation target). This
mirrors the clinical module's ADR-0010 PII-discipline pattern rather than
inventing a new one.

### 6. AI triage: Anthropic Claude Haiku, not the plan text's literal Sonnet mention

MM-PLAN-001 §5 Phase 7 names "Anthropic default" without pinning a model
tier. `createAnthropicAiGateway`'s default
(`DEFAULT_ANTHROPIC_TRIAGE_MODEL = "claude-haiku-4-5"`) is a deliberate
deviation toward the cheaper/faster tier: triage is a low-stakes
specialty-routing hint (never a diagnosis, never returned as free text —
only whitelisted specialty slugs + a boolean), called on every symptom
search, and gated by a deterministic red-flag pre-screen that runs BEFORE
the model regardless of tier. `AI_TRIAGE_MODEL` env override exists for
deployments that want to upgrade the tier without a code change.

### 7. AI triage never logs or returns raw model output or symptom text

`triage-service.ts`'s `tryModel()` catches every failure mode (timeout,
malformed JSON, non-whitelisted specialties) and logs only
`error.message` or a fixed `"unknown ai gateway failure"` string — never
the symptom text, never the raw model response. Proven by
`apps/api/test/ai/triage-service.test.ts`'s "never logs the raw symptom
text, even on the model-failure fallback path" using a real pino logger
with `REDACT_PATHS` wired, asserting a unique marker string is absent from
captured log output.

### 8. SMS provider: Twilio (interface-ready for a swap)

MM-PLAN-001 does not pin a concrete SMS vendor. Twilio is chosen as the
concrete implementation behind the existing `NotifyChannel`/`OtpChannel`
interfaces from `packages/platform`; a future provider swap is an adapter
file plus config/env changes, not a call-site change, per the same
adapter-interface discipline as every other Phase 7 integration (CLAUDE.md
convention #8).

## Mock→real flip checklist (evidence)

The following must all hold before flipping any channel from mock to real
in a given environment:

| Requirement | Evidence |
|---|---|
| Secrets never committed to the repo or logged | `.env.example` documents var names only, no values; `kernel/redaction.ts` redacts `phoneNumber`/`normalizedPhone`/`phone`/`to`/`destination`/`fullName`/`name`/`email` to depth 5 in all pino output |
| Rate limits proven | `apps/api/test/ai/router.test.ts`: "fires the per-caller rate limit independently of the global limit", "fires the global rate limit across distinct callers"; `apps/api/test/identity/otp.test.ts`: "fires the per-IP send-rate limit...", "fires the per-device send-rate limit..." |
| Abuse cases tested | `apps/api/test/communication/abuse.test.ts`: channel kill-switch, destination-country allowlist, daily channel budget, per-scope send-rate limit, velocity anomaly detection — all five guards, both pass and fail paths |
| Kill-switch proven | `apps/api/test/identity/otp.test.ts`: "falls back to SMS when the whatsapp channel is killed", "answers a typed refusal when both channels are killed"; `apps/api/test/communication/abuse.test.ts`: "fires CHANNEL_DISABLED when the channel is killed" |
| Fallback delivery proven | `apps/api/test/communication/dispatch.test.ts`: "a failing email channel doesn't block push delivery, and the email row fails after maxAttempts"; `apps/api/test/ai/triage-service.test.ts`: "falls back to the keyword engine when the model provider is killed" |
| Production guardrail proven | `apps/api/test/mock-production-guard.test.ts`: both the missing-credentials-rejects and full-credentials-boots-past-guard paths |
| PII never persisted outside sanctioned columns | `apps/api/test/communication/dispatch.test.ts`: "never persists the patient's name — notification_log carries linkage PII only" |

## `notification_log` retention

`notification_log.destination` and `.paramsJson` are crypto-shred scope: a
future retention job must erase (not merely soft-delete) these two columns
on rows older than **12–24 months** (exact figure is a policy decision for
that future phase, not fixed here), leaving the row's audit trail
(template, channel, status, timestamps) intact for support/ops history.
No retention job exists yet — this ADR records the scope and window so the
future job's design doesn't have to rediscover which columns qualify.

## Open items (not resolved this phase)

- **MM-DEC rev03 pending.** This phase implements rev02 exactly; any
  future step-up-authentication or OTP-flow amendment is out of scope
  until rev03 locks.
- **F-07 (identity-event PII posture)** remains pending per
  `docs/MM-QA-002-Full-System-Audit.md` — whether identity module events
  should move to id-only v2 payloads is unresolved; this phase's
  subscribers are already id-only by construction (decision 5 above), but
  the identity module's own event contracts are unchanged.
- **F-09 (R17 provenance labeling)** remains pending — the doctor-facing
  continuity-of-care history surface (ADR-0010) still presents
  patient-authored data alongside prescribing data with no provenance
  label; unaffected by this phase, flagged here only because it was an
  open item at Phase 7's start.
- **Locale source decision.** `user_channel_preferences.locale` (nullable,
  default ckb at read time) is the locale source for this phase. Whether
  locale should instead live on the core identity/user profile (so it's
  available to auth flows, not just communication) is left for a future
  phase to decide — the current column is easy to migrate off of since
  nothing outside communication reads it.

## Gate evidence

- **Kill-switch/fallback:** identity OTP send with WhatsApp killed → SMS
  fallback; both channels killed → typed refusal (`otp.test.ts`).
- **Email-adapter-killed gate:** communication sender continues push
  delivery when email fails, and the failing email row reaches `failed`
  after `maxAttempts` (`dispatch.test.ts`).
- **AI-provider-killed gate:** triage falls back to the deterministic
  keyword engine when the model gateway fails, and the red-flag pre-screen
  fires unconditionally before any model call (`triage-service.test.ts`).
- **Reminder cron idempotency:** running the next-day planner twice
  produces exactly one row per remindable appointment; cancelled
  appointments are excluded (`reminders.test.ts`).
- **Production guardrail:** both paths proven
  (`mock-production-guard.test.ts`).
- **Boundaries/lint/typecheck green; full serialized suite green** —
  489/489 tests across 52 files, ~556s wall time (within noise of the
  pre-Phase-7 baseline; the added second pg-boss job-scheduler instance
  per `buildServer()` call did not meaningfully change suite runtime).

## Deviations / notes

- **AI model tier** (decision 6): Claude Haiku default, not Sonnet —
  cost/latency tradeoff for a whitelisted-slug-only, red-flag-gated
  triage hint; overridable via `AI_TRIAGE_MODEL`.
- **SMS provider** (decision 8): Twilio, a concrete choice the plan left
  open; adapter-interface discipline means a future swap is additive.
- **`buildParams`-deferred-locale design** (decision 4): a closure rather
  than a literal reading of "resolve at send time" as a precomputed value
  — resolved pragmatically via the existing published-query pattern,
  documented inline in `plan-notification.ts`.
- **`communication/abuse.test.ts` and OTP's abuse tests exist as two
  separate suites** exercising the same shared `kernel/abuse.ts` guards
  from their two call sites (OTP send, notification sender) — deliberate,
  not duplication: each proves the guard fires from ITS caller's code
  path, not just that the guard function works in isolation.
