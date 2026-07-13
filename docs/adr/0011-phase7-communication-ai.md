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
The fallback checks the recipient's `smsEnabled` preference first and
denies (rather than sends) when it's off — added in the remediation pass
below (F-4); a dead push token falls back the same way, through
`resolveDeliveryPlan` rather than retrying the same gone destination
(F-8).

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
payload. `notification_log.destination` and `.paramsJson`, plus
`device_tokens.token` (a push credential, not merely an identifier), are
the tables in the communication module permitted to hold PII/credential
data, each explicitly documented in schema comments as **crypto-shred
scope, 12–24 month retention** (this ADR is the schema comments' citation
target). This mirrors the clinical module's ADR-0010 PII-discipline pattern
rather than inventing a new one.

**Correction (remediation pass, F-6):** the vendor adapters originally
embedded the destination (and, for push, the token itself) in their thrown
error messages, which the sender stored verbatim in
`notification_log.last_error` — an UNSCOPED column, invisible to this
posture's stated boundary and to pino's field-name redaction (a substring
inside a message isn't a named field). Every adapter's error message is now
status-only; see the remediation section below.

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

## Remediation pass (independent adversarial audit)

Before this branch merged, an independent adversarial review of the Phase 7
diff (not the implementer) found one merge-blocker, ten issues serious
enough to fix before production, and nine lower-priority findings
(F-11–F-19). All are resolved on this branch except the one item explicitly
called out as deferred technical debt below (part of F-17); every fix has a
regression test that fails against the pre-fix code and passes against the
fix — not merely a test that the mechanism exists in isolation.

- **F-1 (merge blocker) — dedupe key collapsed onto the aggregate, not the
  occurrence.** `notification_log.dedupeKey` was `template:aggregateId:
channel`, where `aggregateId` was `appointmentId` (or `patientProfileId`
  when there's no appointment). This silently dropped every notification
  after the first for the SAME aggregate: a patient's second-ever
  prescription (no appointment, so keyed on `patientProfileId` alone) never
  notified; a second reschedule of the same appointment never notified
  (the patient kept believing the first new time); a subscription's second
  lapse/reactivation cycle never notified (keyed on the stable
  `subscriptionId`). Fixed by threading the triggering `domain_events.id`
  through `EventHandlerFn` as an additive third parameter (`(envelope, tx,
eventId)` — existing 2-parameter handlers remain valid, TS permits fewer
  declared parameters) and using it as the new `occurrenceKey` component of
  the dedupe key; the non-event-driven reminder cron uses
  `appointmentId:startsAt` instead (a reschedule changes `startsAt`, so it
  re-plans; a same-day double run doesn't). Proven by four new tests: a
  second reschedule, a second prescription, a subscription
  lapse/reactivate/lapse/reactivate cycle, and a rescheduled appointment's
  reminder — all now produce a fresh notification instead of silently
  planning nothing.
- **F-2 — velocity anomaly detection was permanently inert.**
  `recordVelocity` counted `send_rate_events` rows under scope `"phone"`,
  but no production code path ever wrote that scope (only `"ip"`/`"device"`
  did) — the count was always zero, so the alert could never fire. The
  original test passed anyway because it manually seeded scope-`"phone"`
  rows itself. Fixed by making `recordVelocity` self-recording (it inserts
  its own event before counting) and wiring it into the OTP send path too
  (it previously only ran from the notification sender). The test now
  drives real rows through the real `NotificationSender.pump()` — the
  actual production call site — instead of seeding the table by hand.
- **F-3 — no HTTP timeout on four of five vendor adapters.** WhatsApp,
  Twilio, Expo, and Resend used plain `fetch` with no `AbortSignal`; only
  the Anthropic gateway bounded its call. A stalled vendor connection could
  hang for undici's default (minutes), which sits in the interactive OTP
  request path and can outlast the sender's batch claim window. Fixed by
  adding a 10s `AbortSignal.timeout` to all four (matching the AI
  gateway's existing pattern), and resizing `CLAIM_HOLD_MS` from a flat 30s
  to `PUMP_BATCH_SIZE × MAX_ROW_PROCESSING_MS` (worst case: every row in
  the batch hits two full adapter timeouts serially, via the WhatsApp→SMS
  fallback) — a fixed 30s window was trivially exceeded by ordinary vendor
  latency well before any timeout ever fired, letting a second instance
  re-claim and double-send rows still mid-flight in the first.
- **F-4 — the WhatsApp→SMS fallback ignored the recipient's `smsEnabled`
  preference.** A patient who explicitly disabled SMS still received it
  whenever WhatsApp failed. Fixed: the fallback now checks the preference
  first (resolved the same way `resolveDeliveryPlan` does) and denies
  (`sms_disabled_by_preference`) instead of sending when it's off.
- **F-5 — `req.ip` collapses behind any reverse proxy without
  `trustProxy`.** Every per-IP guardrail (identity OTP send-rate, AI triage
  rate limit) keys on `ctx.req.ip`/`req.ip`; unconfigured, every request
  behind a load balancer resolves to the LB's own address, merging every
  real caller into one shared bucket — an accidental denial-of-service for
  every legitimate caller once one triggers the limit. Added `TRUST_PROXY`
  env (unset/`"false"` → trust nothing; `"true"` → trust every hop;
  comma-separated list → trust only those proxy addresses) wired into
  Fastify's own `trustProxy` option, documented in `.env.example` as a
  **required** production setting behind any proxy.
- **F-6 — destination/token PII leaked into `last_error`.** See the
  correction under decision 5 above.
- **F-7 — one malformed row could wedge the whole delivery pipeline.**
  `JSON.parse(row.paramsJson)` ran outside any try/catch inside
  `processRow`; a corrupt row threw out of the per-batch loop entirely,
  abandoning every other claimed row, and re-sorted first on every
  subsequent pump (oldest `nextAttemptAt`), wedging delivery indefinitely.
  Fixed by wrapping each row's processing in `pump()`'s loop so a failure
  routes through the normal `markFailedOrRetry` path instead of escaping
  the loop.
- **F-8 — a dead push token kept being retried instead of falling back.**
  On `PushTokenInvalidError` the dead `device_tokens` row was deleted, but
  the notification row itself kept retrying push against the same
  now-nonexistent token until `maxAttempts`, even when the patient had a
  working phone/email on file. Fixed: the sender now re-runs
  `resolveDeliveryPlan` (which, with the token gone, naturally picks
  WhatsApp or email next) and attempts one immediate delivery on the
  alternate channel, updating the row in place — mirrors the WhatsApp→SMS
  fallback's own shape.
- **F-9 — no way to unregister a device token.** A user logging out on a
  shared or discarded device kept receiving push there indefinitely (no
  code path deleted a `device_tokens` row on logout). Added
  `communication.unregisterDeviceToken` (session-bound, deletes only the
  caller's own token; unowned or already-gone tokens are a silent
  no-op — logout must never error on a stale token).
- **F-10 — the in-memory rate limiter grows without bound and its
  multi-instance semantics were undocumented.** `packages/domain/ai/
rate-limit.ts`'s module-level `Map` never evicted anything (every
  distinct key — e.g. every IP hitting the public AI triage endpoint —
  accumulated forever) and, with N API instances, a configured cap is
  actually enforced N× wider (each instance holds its own independent Map).
  Fixed the growth: buckets idle past a 2-hour staleness window (safely
  above every policy window in this system) are swept periodically —
  behaviorally identical to a fresh bucket, since that much idle time would
  have refilled it to full capacity anyway; this bounds memory without
  changing rate-limiting behavior for any key still in use. The
  multi-instance multiplier is now documented in the module's own doc
  comment for whoever sizes `ai.triage_rate_policy` next; fixing it
  requires a shared store (Redis, explicitly deferred per MM-PLAN-001 §8) —
  accepted as technical debt, not silently left undocumented.

### Priority 3 findings (F-11–F-19)

- **F-11 — a transient DB failure right after a successful vendor send
  could cause a duplicate real-world delivery.** `processRow` wrote the
  `sent` status and `recordVelocity` inside the SAME try/catch as the
  vendor send call; if either write threw (e.g. a dropped DB connection),
  the row fell through to `markFailedOrRetry`, which flips it back to
  `pending` — the next pump would resend a WhatsApp/SMS/push/email message
  the recipient already received. Fixed: `markSentWithRetry` persists the
  sent status in its own retry loop (3 attempts, 200ms apart), separated
  from the send-failure path entirely; `recordVelocity` failures are
  logged and swallowed rather than triggering a resend. A residual window
  remains (the DB failing on every retry AND recovering before
  `CLAIM_HOLD_MS` elapses) — accepted, since closing it fully needs a
  vendor-side idempotency key this system doesn't have; logged loudly for
  manual reconciliation if it's ever hit.
- **F-12 — `stop()` didn't wait for an in-flight pump.** Server shutdown
  called `notificationSender.stop()` synchronously, then closed the DB
  pool immediately after — a pump still mid-batch would start throwing
  pool-closed errors instead of finishing or failing cleanly. `stop()` is
  now `async` and awaits the currently in-flight pump (if any) before
  returning; `app.ts`'s `onClose` hook awaits it.
- **F-13 — OTP messages always rendered in ckb and always claimed a fixed
  "10 minutes" regardless of the actual configured expiry.** The
  hardcoded "10" was worse than a missed preference: `IdentityOtpOptions
.expiresInSeconds` defaults to 300s (5 minutes), so the message was
  actively wrong by default. Fixed both: `OtpMessage` gained
  `expiresInMinutes`, computed once from the same `expiresInSeconds`
  value the Better Auth phone plugin itself uses (`DEFAULT_OTP_EXPIRES_IN_SECONDS`,
  single source of truth) and threaded through both adapters' template
  rendering. Locale: since an OTP is sent before any account/preference
  row exists, there's no stored locale to read — `auth.ts`'s `sendOTP`
  callback now best-effort resolves `Accept-Language` to a platform
  `Locale` (`localeFromAcceptLanguage`, with "ku" mapped to this
  platform's "ckb" catalog) and falls back to the platform default when
  absent or unrecognized.
- **F-14 — `listRecentNotifications` was written, tested nowhere, and
  never mounted.** Dead code the audit found by grepping for its only
  reference (its own file). Mounted as `communication.listRecentNotifications`,
  `roleProcedure("admin")`-gated (mirrors `system.outboxStats`'s
  precedent for ops-only reads) rather than the clinical module's
  support-grant-gated pattern, since its column selection already
  excludes PII by construction (no `destination`/`paramsJson`) — it's a
  general ops read, not a targeted clinical-data access needing an audit
  trail.
- **F-15 — no pruning/retention job for `send_rate_events`,
  `channel_spend`, or `abuse_alerts`.** These three abuse-guardrail tables
  grow forever (no PII, unlike `notification_log`, but still unbounded
  rows). Not fixed this pass — a retention job is genuinely a future
  phase's concern (ops/scheduling infrastructure, not a Phase 7 code
  change) — but recorded explicitly as technical debt in "Open items"
  below instead of staying an undocumented gap, per this remediation
  pass's own standard.
- **F-16 — this ADR's own text had drifted from the implementation.**
  Decision 5 claimed only `notification_log` columns held PII, omitting
  `device_tokens.token`; several fixes above (F-1 through F-10) had no
  ADR record at all. This document is the fix.
- **F-17 — the deterministic red-flag keyword pre-screen had asymmetric,
  incomplete coverage.** `"can't breathe"` didn't match "cant breathe" /
  "can’t breathe" (curly apostrophe) / "cannot breathe" / "unable to
  breathe" / "trouble breathing" — a real difference in a safety-critical
  pre-screen that runs before any model call. Arabic had no
  breathing-difficulty phrase at all. Fixed: `containsRedFlag` now strips
  apostrophes (straight and curly) before matching English phrases so
  contraction variants collapse to one keyword, the English list gained
  the non-contraction phrasings above, and Arabic gained "صعوبة في
  التنفس" / "لا أستطيع التنفس". **Deliberately NOT expanded:** the
  Kurdish (Sorani) list stays at 3 entries (chest pain, suicidal
  ideation, breathing difficulty — missing stroke/heart attack/overdose/
  severe bleeding) rather than adding phrases translated without
  clinical/native-speaker review — a plausible-looking but wrong phrase in
  a safety pre-screen is a worse outcome than the known, documented gap.
  Tracked in "Open items" below.
- **F-18 — a dead, unreachable `"sms"` branch in
  `tryFallbackAfterDeadPushToken`.** `resolveDeliveryPlan` only ever plans
  `push`, `whatsapp`, or `email` — never `sms` — so the
  `fallback.channel === "sms"` send branch in the dead-push-token fallback
  could never execute. Found in review; removed. Only `whatsapp` and
  `email` remain as possible fallback send targets.
- **F-19 — the dead-push-token fallback's WhatsApp attempt had no SMS
  cascade on failure, unlike the primary delivery path.** `processRow`'s
  own WhatsApp send falls back inline to SMS on failure (respecting
  `smsEnabled`, F-4); `tryFallbackAfterDeadPushToken`'s WhatsApp attempt
  did not — a failed WhatsApp fallback fell straight through to
  `markFailedOrRetry`, silently skipping a working phone number the
  primary path would have used, and (had it cascaded naively) would have
  done so with no consent check. Found in review; fixed: the fallback now
  mirrors the primary path's cascade exactly — checks
  `isSmsFallbackAllowed` first (denies as `sms_disabled_by_preference` if
  off, same as F-4), then attempts SMS against the same destination
  (WhatsApp's destination here is already the normalized phone) before
  giving up. Proven by two new tests in `dispatch.test.ts`: "cascades to
  SMS when the dead-push-token fallback's WhatsApp attempt also fails" and
  "honors a disabled SMS preference on the dead-push-token fallback —
  never cascades to SMS" (the second asserting `channels.sms.send` is
  never invoked).

## Mock→real flip checklist (evidence)

The following must all hold before flipping any channel from mock to real
in a given environment:

| Requirement                                                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets never committed to the repo or logged                                                 | `.env.example` documents var names only, no values; `kernel/redaction.ts` redacts `phoneNumber`/`normalizedPhone`/`phone`/`to`/`destination`/`fullName`/`name`/`email` to depth 5 in all pino output                                                                                                                                                                                                                                                                                                                                                                   |
| Rate limits proven                                                                            | `apps/api/test/ai/router.test.ts`: "fires the per-caller rate limit independently of the global limit", "fires the global rate limit across distinct callers"; `apps/api/test/identity/otp.test.ts`: "fires the per-IP send-rate limit...", "fires the per-device send-rate limit..."; `packages/domain/ai/rate-limit.test.ts`: capacity/refill/distinct-key/eviction (ADR-0011 F-10)                                                                                                                                                                                  |
| Abuse cases tested                                                                            | `apps/api/test/communication/abuse.test.ts`: channel kill-switch, destination-country allowlist, daily channel budget, per-scope send-rate limit, and (rewritten, ADR-0011 F-2) an end-to-end velocity anomaly test driving real rows through the real `NotificationSender.pump()` call path, not a hand-seeded count                                                                                                                                                                                                                                                  |
| Kill-switch proven                                                                            | `apps/api/test/identity/otp.test.ts`: "falls back to SMS when the whatsapp channel is killed", "answers a typed refusal when both channels are killed"; `apps/api/test/communication/abuse.test.ts`: "fires CHANNEL_DISABLED when the channel is killed"                                                                                                                                                                                                                                                                                                               |
| Fallback delivery proven                                                                      | `apps/api/test/communication/dispatch.test.ts`: "a failing email channel doesn't block push delivery, and the email row fails after maxAttempts"; "falls back to WhatsApp when the push token is dead..." (F-8); "honors a disabled SMS preference..." (F-4); "cascades to SMS when the dead-push-token fallback's WhatsApp attempt also fails" and "honors a disabled SMS preference on the dead-push-token fallback — never cascades to SMS" (F-19); `apps/api/test/ai/triage-service.test.ts`: "falls back to the keyword engine when the model provider is killed" |
| Vendor calls are timeout-bounded                                                              | `packages/platform/{whatsapp-meta,sms-twilio,push-expo,email-resend}.test.ts`: "aborts a stalled request after timeoutMs instead of hanging" (ADR-0011 F-3), one per adapter                                                                                                                                                                                                                                                                                                                                                                                           |
| Notification occurrences are never silently deduped away                                      | `apps/api/test/communication/dispatch.test.ts`: second reschedule, second prescription, subscription lapse/reactivate cycle; `apps/api/test/communication/reminders.test.ts`: reschedule re-plans a fresh reminder (ADR-0011 F-1, merge blocker)                                                                                                                                                                                                                                                                                                                       |
| One bad row can't wedge the queue                                                             | `apps/api/test/communication/dispatch.test.ts`: "a single malformed row doesn't block the rest of the batch" (ADR-0011 F-7)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `req.ip` resolves correctly behind a configured proxy, and collapses safely when unconfigured | `apps/api/test/trust-proxy.test.ts` (ADR-0011 F-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Device tokens are released on logout                                                          | `apps/api/test/communication/router.test.ts`: own-token unregister, cross-user no-op, unregister-of-nonexistent-token no-op (ADR-0011 F-9)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A successful delivery is never resent because of a later DB write failure                     | `apps/api/test/communication/dispatch.test.ts`: "retries persisting the sent status after a transient DB failure instead of resending" (ADR-0011 F-11)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Shutdown waits for an in-flight pump                                                          | `apps/api/test/communication/dispatch.test.ts`: "stop() waits for an in-flight pump to finish before resolving" (ADR-0011 F-12)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| OTP messages state the real expiry and a best-effort recipient locale                         | `packages/platform/{whatsapp-meta,sms-twilio}.test.ts`: "renders the message's actual expiresInMinutes, not a hardcoded figure"; `apps/api/test/identity/locale-from-accept-language.test.ts` (ADR-0011 F-13)                                                                                                                                                                                                                                                                                                                                                          |
| The ops notification feed is admin-gated and excludes PII                                     | `apps/api/test/communication/router.test.ts`: "rejects a non-admin caller...", "lists recent notifications for an admin caller, excluding destination/paramsJson" (ADR-0011 F-14)                                                                                                                                                                                                                                                                                                                                                                                      |
| The red-flag pre-screen catches common breathing-emergency phrasings in English and Arabic    | `packages/domain/ai/symptom-triage-utils.test.ts`: apostrophe-variant and non-contraction phrasings, Arabic breathing-difficulty phrases (ADR-0011 F-17)                                                                                                                                                                                                                                                                                                                                                                                                               |
| Production guardrail proven                                                                   | `apps/api/test/mock-production-guard.test.ts`: both the missing-credentials-rejects and full-credentials-boots-past-guard paths                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| PII never persisted outside sanctioned columns                                                | `apps/api/test/communication/dispatch.test.ts`: "never persists the patient's name — notification_log carries linkage PII only"; adapter tests above additionally assert the destination/token never appears in a thrown error's message or cause (ADR-0011 F-6)                                                                                                                                                                                                                                                                                                       |

## `notification_log` retention

`notification_log.destination` and `.paramsJson` are crypto-shred scope: a
future retention job must erase (not merely soft-delete) these two columns
on rows older than **12–24 months** (exact figure is a policy decision for
that future phase, not fixed here), leaving the row's audit trail
(template, channel, status, timestamps) intact for support/ops history.
No retention job exists yet — this ADR records the scope and window so the
future job's design doesn't have to rediscover which columns qualify.

### Other unbounded-growth tables (ADR-0011 F-15, deferred)

`send_rate_events`, `channel_spend`, and `abuse_alerts` (all
`kernel/abuse.ts`-owned) carry no PII — unlike `notification_log`, there's
no crypto-shred obligation — but also have no pruning job, so all three
grow without bound. Not fixed in this remediation pass: a retention/pruning
job is ops/scheduling infrastructure work for a future phase, not a Phase 7
code change, and the "how far back" retention window is itself a policy
decision (mirrors the `notification_log` situation above). Recorded here
explicitly rather than left an undocumented gap.

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
- **`formatAppointmentDateTime` renders a fixed locale, not the recipient's.**
  Template bodies interpolate this helper's output for the appointment
  time, but the helper does not currently take the resolved `Locale` that
  `planNotification` already computed for everything else in the template —
  it formats in a single fixed locale regardless of who receives the
  message. Left open rather than fixed in this remediation pass because it
  requires deciding a per-locale date/time format convention (ICU vs.
  hand-rolled) that's outside this pass's scope of "fix what the audit
  flagged as broken behavior"; tracked here so it isn't lost.
- **F-15 — no pruning job for `send_rate_events`/`channel_spend`/
  `abuse_alerts`.** See the dedicated section above; deferred as
  ops/scheduling infrastructure work, not a Phase 7 code change.
- **F-17 — the Kurdish (Sorani) red-flag keyword list is narrower than
  English/Arabic.** 3 entries (chest pain, suicidal ideation, breathing
  difficulty) vs. 7/8 — missing stroke, heart attack, overdose, severe
  bleeding. Deliberately not expanded without native-speaker/clinical
  translation review (see the F-17 remediation entry above for why);
  closing this needs a reviewed translation, not an engineering guess.
- **`REMINDER_CRON`'s schedule is in UTC, not Baghdad local time.** pg-boss
  schedules cron expressions against UTC by default; `.env.example`'s
  comment now says so explicitly (previously unstated, which risked a
  deploy configuring the intended Baghdad send hour without the UTC+3
  offset).

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
- **Remediation-pass gates (independent adversarial audit, F-1–F-10):**
  occurrence-key dedupe (reschedule/prescription/subscription/reminder
  regression tests), end-to-end velocity detection, per-adapter timeout
  aborts, SMS-preference-respecting fallback, dead-push-token fallback,
  single-bad-row batch isolation, `trustProxy` IP resolution, device-token
  unregister, rate-limiter eviction — see "Remediation pass" above for the
  full list and "Mock→real flip checklist" for the updated evidence table.
- **Priority-3 follow-up review (F-18–F-19):** dead unreachable `"sms"`
  branch in the dead-push-token fallback removed; that same fallback now
  cascades WhatsApp→SMS on failure (consent-checked, same as the primary
  path) instead of giving up — see the two new `dispatch.test.ts` tests
  cited in "Fallback delivery proven" above.
- **Boundaries/lint/typecheck green; full serialized suite green** — see
  the final gate run recorded at the end of this ADR's remediation pass
  for the post-fix test count (superseding the original 489/489 baseline
  above, which predates the remediation pass's ~30 new/changed tests).

**Note on test timing (`dispatch.test.ts` flakes — two distinct root
causes, both root-caused, neither widened):** this file flaked twice with
different symptoms, and they were NOT the same defect. An earlier
attribution of the second to the first was disproven by CI evidence and is
corrected here.

_Root cause 1 — uncontrolled background sender (local F-11 flake)._
`buildServer` (app.ts) unconditionally starts its own background
`NotificationSender` at the production default 5s poll interval, against
the real db and its own internally-wired mock channels. Every test in
`dispatch.test.ts` also builds and drives its _own_ instrumented sender
over the same shared `notification_log`. Because `claimBatch` selects
`FOR UPDATE SKIP LOCKED`, under contention the background poller and the
test's `pump()` race for — and can split — the very rows under assertion,
each processing them with its own `maxAttempts`/mocks. F-11 ("retries
persisting the sent status after a transient DB failure") flaked locally
this way with `sentWriteAttempts === 0`: the background poller marked the
row `sent` before the test's own `claimBatch()` ran. Reproduced
deterministically: with the poller forced to 50ms under CPU load the full
file failed on every one of six runs (varying which assertion tripped);
with the poller disabled it passed six of six under identical load. Fix:
`apps/api/test/helpers.ts`'s `testEnv()` pushes
`NOTIFICATION_POLL_INTERVAL_MS` out to an hour — no test relies on the
auto-poller, so it can no longer tick during a test run at all.

_Root cause 2 — mixed clock sources in the due-scan (CI F-7 flake)._ After
the poller fix was already in the tree, CI (which provisions the database
as a `postgres:16` service container via `TEST_DATABASE_URL`, unlike the
local embedded-PG-on-the-same-host harness) still failed F-7 ("a single
malformed row doesn't block the rest of the batch") with the poison row
`pending` — and, decisively, with the GOOD row's `sent` assertion passing.
One `pump()` claimed the row inserted first but not the row inserted
milliseconds later, which a batch-size overflow cannot produce (measured:
2 due rows against a batch limit of 50) and the disabled poller cannot
produce. The mechanism: rows are stamped `next_attempt_at = defaultNow()`
— the DATABASE's clock — but `claimBatch` compared them against the NODE
process clock (`new Date()`), and `markFailedOrRetry` wrote retry backoff
from the Node clock too. With the DB clock a few ms ahead of the app
host's clock (separate container, or an NTP step between the insert and
the claim), a freshly-inserted row is "not yet due" at claim time. In
production this only delays a row by one 5s poll tick — harmless; in an
insert-then-immediately-pump test it reads as a lost row. Fix: every
write and comparison of `next_attempt_at` (`claimBatch`'s due-scan and
hold-window write, `markFailedOrRetry`'s backoff) now uses the database's
own `now()` — one clock source, class eliminated rather than narrowed.
Proven by a regression test ("claims a freshly-inserted row even when the
process clock lags the database clock") that fakes only `Date` 5s behind
the DB clock: it fails against the old `new Date()` due-scan with the
exact CI symptom (`pending`, never claimed) and passes with the `now()`
scan.

Both are the same environment-sensitivity class as the Phase 3
outbox-drain timing note (`docs/adr/0007-phase5-clinical.md`), and both
are root-cause fixes, not widened timeouts. If a similar flake resurfaces
(a row asserted `pending`/`sent`/`failed` that mysteriously holds the
opposite state), check — in this order — for an uncontrolled background
actor sharing the test database, then for a wall-clock comparison that
mixes the DB's clock with the process's.

**Note on test timing (`claim.test.ts` 30s flake, root-caused not just
widened):** a prior session recorded an intermittent 30s-timeout flake in
`apps/api/test/identity/claim.test.ts` under full-suite load (passing in
isolation) — the same broad environment-contention class as the F-11 flake
above, but a distinct mechanism. Profiling the file showed every
password/query step is sub-second even under a loaded full run (the
`@better-auth/utils` scrypt hash — N=16384, r=16 — measures ~230ms
isolated; the file's slowest test ran 2.3s inside a green full run), so
scrypt was a red herring. The one operation that could plausibly approach
30s under pathological initdb/fsync contention was structural: the second
`describe` block ("claim atomicity") provisioned its embedded-Postgres
cluster (`createTestDatabase()` + `buildServer()`, i.e. initdb + start +
migrations) _inside the test body_, which vitest bounds by the 30s
`testTimeout` — whereas every other integration test in the suite, and
this file's own first `describe`, provisions in a `beforeAll` bounded by
the far larger 120s `hookTimeout`. Fixed at the root by hoisting that
provisioning into `beforeAll`/`afterAll` for the second `describe` too, so
no heavy setup runs under the 30s bound anywhere in the file — a
structural consistency fix, not a widened number. Validated by three
consecutive fully-uncached (`--force`) serialized full-suite runs, all
green (see the run log below).

**Note on `otel.test.ts` (CI EADDRINUSE flake, root-caused):** CI run
29212913871 failed only in this file: the mock OTLP collector listened on
a hardcoded port (43118) that another process on the runner already held.
The `EADDRINUSE` error surfaced as an uncaught `'error'` event (the
`listen` callback never fired), `beforeAll` hung to the 60s hook timeout,
and `afterAll` then threw a `TypeError` because `api` was never assigned —
masking the real failure. Fix at the root: the collector now binds to an
ephemeral port (`listen(0)`) and the OS-assigned port is read back from
`collector.address().port` and passed to the spawned artifact via
`OTEL_EXPORTER_OTLP_ENDPOINT`, eliminating the collision class rather than
picking a "less popular" fixed port. `afterAll` is now defensive against
partial setup (guards on `api`/`collector`/`tdb`) so a genuine setup
failure reports itself instead of a teardown `TypeError`. Validated by
three consecutive fully-uncached (`--force`) serialized full-suite runs,
all green (54 files / 516 tests each).

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
