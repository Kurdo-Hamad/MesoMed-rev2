# Phase 7 — Communication + AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Communication module (event-driven notification dispatch, trilingual templates, notification log, channel preferences, device tokens, next-day reminder cron), real WhatsApp/SMS/Expo-push/Resend adapters behind platform interfaces, mandatory abuse controls, PII log redaction, and the AI triage module — landing as one PR `phase-7-communication-ai` → `main`, gate green, zero regressions vs 700 tests / 80 files.

**Architecture:** Subscribers consume booking/billing/clinical events id-only and *plan* deliveries by inserting `notification_log` rows (status `pending`) inside the handler transaction — exactly-once by construction. A kernel-style sender loop processes pending rows (channel adapters, attempts, backoff, terminal `failed`), so a dead channel retries without blocking others. Channel routing: push if a device token exists and preferences allow; else WhatsApp→SMS for phone destinations; email secondary. Abuse guardrails (kill-switch, destination allowlist, daily budget, per-key rate, velocity alerts) are kernel infrastructure (shared by identity OTP and communication sends), config-driven per convention #9. AI triage ports the staged pipeline behind an `AiGateway` platform interface (Vercel AI SDK, Anthropic default) with deterministic keyword fallback.

**Tech Stack:** Fastify + tRPC + Drizzle + pg-boss (existing), `ai` + `@ai-sdk/anthropic` (new, platform package only), raw `fetch` adapters for Meta Graph API / Twilio SMS / Expo Push / Resend (injectable fetch for fixture-based contract tests).

## Global Constraints

- All work in `~/mesomed` (WSL clone). Branch `phase-7-communication-ai`; PR to `main`; no merge.
- Conventions #1–#15 (CLAUDE.md §3) apply; notably: communication writes only its own tables; adapters' vendor calls only inside `packages/platform`; config over code; trilingual catalogs, no hardcoded strings; typed error codes; testing DoD per command (happy + authz-denial + invariant-violation).
- No raw symptom text in logs anywhere; communication tables persist no event-payload PII beyond the `notification_log` linkage (phone/appointment), marked crypto-shred in schema comments.
- Tests run `--concurrency=1` locally (embedded PG starvation).
- Out of scope: FIB/ZainCash live, Meilisearch, Redis, prescribing UI, ckb/ar search normalization, MM-DEC rev03 behavior, queue-position live updates.

---

### Task 1: Branch + contracts + config schemas

**Files:**
- Modify: `packages/contracts/src/errors.ts` — add `CHANNEL_DISABLED`, `DESTINATION_NOT_ALLOWED`, `CHANNEL_BUDGET_EXCEEDED`, `AI_QUOTA_EXCEEDED` (Phase 7, additive).
- Modify: `apps/api/src/kernel/errors.ts` — map: CHANNEL_DISABLED→PRECONDITION_FAILED, DESTINATION_NOT_ALLOWED→FORBIDDEN, CHANNEL_BUDGET_EXCEEDED→TOO_MANY_REQUESTS, AI_QUOTA_EXCEEDED→TOO_MANY_REQUESTS.
- Modify: `packages/i18n/src/messages/{en,ar,ckb}.json` — `errors.*` entries for the four codes.
- Modify: `packages/config/src/index.ts` — add config keys + Zod schemas:
  - `communication.channel_kill_switch` → `channelKillSwitchSchema`: partial record channel(`push|whatsapp|sms|email`)→boolean (true = killed; missing = enabled; missing row = all enabled).
  - `communication.destination_countries` → `destinationCountriesSchema`: record ISO country → `{ prefixes: string[] }` (E.164 prefixes). Resolver `resolveDestinationCountry(config, phone)` returns country code or null (null = denied, fail closed). Seeded `{ IQ: { prefixes: ["+964"] } }`.
  - `communication.channel_budgets` → `channelBudgetsSchema`: partial record channel → `{ dailyLimit: number, alarmAt: number }`.
  - `communication.send_rate_policy` → per-scope `{ maxSends, windowSeconds }` for scopes `phone|ip|device`.
  - `communication.velocity_policy` → `{ threshold, windowSeconds }` (per destination key per channel).
  - `ai.triage_rate_policy` → `{ perUser: {capacity, refillPerSecond}, perIp: {...}, global: {...} }`.
- Test: `packages/config/src/index.test.ts` (extend existing pattern) — schema round-trips + fail-closed resolvers.

**Steps:** write failing schema tests → implement → `pnpm --filter @mesomed/config test` → commit.

### Task 2: DB schema + migration 0008

**Files:**
- Create: `packages/db/src/schema/communication.ts`
  - `notification_log`: id uuid pk; `patientProfileId` uuid null; `userId` text null; `appointmentId` uuid null; `template` text; `channel` text enum push|whatsapp|sms|email; `destination` text null (**schema comment: PII — phone/email/device token; crypto-shred scope; retention 12–24 months per ADR-0011**); `locale` text; `status` text enum pending|sent|failed|denied notNull default pending; `attempts` integer notNull default 0; `nextAttemptAt` timestamptz notNull defaultNow; `lastError` text; `dedupeKey` text notNull unique; `createdAt`/`updatedAt`. Indexes: `(status, next_attempt_at)` partial `WHERE status='pending'` for the sender; `(channel, created_at)` for spend/ops.
  - `user_channel_preferences`: `userId` text pk; booleans `pushEnabled|whatsappEnabled|smsEnabled|emailEnabled` default true; `locale` text null; timestamps.
  - `device_tokens`: id uuid pk; `userId` text notNull; `token` text notNull unique; `platform` text enum ios|android; `createdAt`, `lastSeenAt`. Index on userId.
- Modify: `packages/db/src/schema/kernel.ts` — abuse-guard infra tables (kernel infra like `processed_events`):
  - `channel_spend`: `channel` text + `day` date composite pk; `count` integer notNull default 0.
  - `send_rate_events`: id uuid pk; `scope` text (phone|ip|device); `key` text; `sentAt` timestamptz. Index `(scope, key, sent_at)`.
  - `abuse_alerts`: id uuid pk; `kind` text (velocity|budget); `channel` text; `key` text (**comment: may carry a phone — crypto-shred scope**); `details` jsonb; `createdAt`.
- Modify: `packages/db/src/schema/booking.ts` — add index `appointments_status_starts_idx` on `(status, starts_at)` (reminder window scan — MUST be indexed).
- Modify: `packages/db/src/schema/index.ts` — export communication schema.
- Generate: `packages/db/migrations/0008_*.sql` via `pnpm --filter @mesomed/db db:generate`.

**Steps:** schema → generate → inspect SQL (comments present via `COMMENT ON` may need hand-added SQL statements appended to migration for crypto-shred notes; drizzle doesn't emit comments — add them as raw SQL in the migration) → migration applies in test harness → commit.

### Task 3: Platform adapters — WhatsApp (Meta), SMS, Expo push, Resend email, AiGateway

**Files (packages/platform/src):**
- Create `notify.ts`: `NotifyChannel` interface `{ readonly kind: "whatsapp"|"sms"; send(msg: { to: string; body: string }): Promise<void> }` + `NotifySendError`.
- Create `push.ts`: `PushChannel` `{ send(msg: { token: string; title: string; body: string; data?: Record<string,string> }): Promise<void> }` + `PushSendError` + `PushTokenInvalidError` (Expo `DeviceNotRegistered`).
- Create `whatsapp-meta.ts`: `createMetaWhatsAppAdapter({ accessToken, phoneNumberId, baseUrl?, fetchImpl? })` returning `{ notify: NotifyChannel, otp: OtpChannel }`. Meta Graph API `POST {baseUrl}/{phoneNumberId}/messages` with `type: "text"`; OTP body rendered from i18n catalog key `identity.otp.message` by locale. Non-2xx → typed send errors. No secret in error messages.
- Create `sms-twilio.ts`: `createTwilioSmsAdapter({ accountSid, authToken, from, baseUrl?, fetchImpl? })` returning `{ notify: NotifyChannel, otp: OtpChannel }` — `POST /2010-04-01/Accounts/{sid}/Messages.json`, basic auth, form-encoded.
- Create `push-expo.ts`: `createExpoPushAdapter({ accessToken?, baseUrl?, fetchImpl? })` — `POST https://exp.host/--/api/v2/push/send`; map `DeviceNotRegistered` → `PushTokenInvalidError`.
- Create `email-resend.ts`: `createResendEmailAdapter({ apiKey, from, baseUrl?, fetchImpl? })` implementing existing `EmailChannel`.
- Create `ai.ts`: `AiGateway` interface `{ generate(input: { system: string; prompt: string; maxTokens: number; timeoutMs: number }): Promise<string> }` + `AiGatewayError`.
- Create `ai-anthropic.ts`: `createAnthropicAiGateway({ apiKey, model? })` via Vercel AI SDK `generateText` + `AbortSignal.timeout`.
- Create mocks with `readonly isMock: true`: `notify-mock.ts` (records sends; `failNext()`), `push-mock.ts`, `ai-mock.ts` (queued responses / failure mode). Existing `otp-mock`/`email-mock` gain `isMock: true`.
- Create `mock-flag.ts`: `isMockAdapter(x: unknown): boolean` checking `isMock === true`.
- Modify `index.ts` exports; modify `package.json` deps (`ai`, `@ai-sdk/anthropic`, `@mesomed/i18n`).
- Tests (contract, fixture-driven fetch): `whatsapp-meta.test.ts`, `sms-twilio.test.ts`, `push-expo.test.ts`, `email-resend.test.ts`, `ai-anthropic.test.ts` (mock provider via injected fetch is impractical for AI SDK — test `ai-mock` + timeout/error mapping with a fake model via `ai`'s `MockLanguageModel` if available, else gate the anthropic impl behind env-gated live test and unit-test the wrapper's error mapping with a stubbed SDK call).

### Task 4: Kernel — redaction, abuse guards, metrics, scheduler

**Files:**
- Create `apps/api/src/kernel/redaction.ts`: exported `REDACT_PATHS` (phone/name/email/destination/to fields at depths 1–3: `phoneNumber`, `*.phoneNumber`, `*.*.phoneNumber`, `normalizedPhone` …, `fullName` …, `patientPhone`, `to`, `destination`, `email` variants) + wired into the Fastify logger options in `app.ts` (`redact: { paths: REDACT_PATHS, censor: "[REDACTED]" }`).
- Test `apps/api/test/redaction.test.ts`: pino instance with app's redact config logging `{ phoneNumber: "+9647...", err: {...} }` and nested variants → output folded.
- Create `apps/api/src/kernel/abuse.ts` (uses kernel tables + config service; typed AppErrors):
  - `assertChannelEnabled(config, channel)` → CHANNEL_DISABLED.
  - `assertDestinationAllowed(config, phone)` → DESTINATION_NOT_ALLOWED (fail closed on missing row/unmatched prefix).
  - `checkAndSpendBudget(db, config, channel, now)` → increments `channel_spend` upsert; over `dailyLimit` → CHANNEL_BUDGET_EXCEEDED + `abuse_alerts` row (kind budget, once per day per channel via alarm-at detection); at `alarmAt` → alert row only.
  - `assertSendRate(db, config, scope, key, now)` → windowed count over `send_rate_events` + insert → RATE_LIMITED.
  - `recordVelocity(db, config, channel, key, now)` → threshold breach inserts `abuse_alerts` (kind velocity) — hook, never throws.
- Create `apps/api/src/kernel/metrics.ts`: OTel meter (`@opentelemetry/api`) counter `mesomed.notifications.sent` with attributes `{ channel, status }`; `recordNotificationSend(channel, status)`. (Channel-mix instrumentation required from Phase 7.)
- Create `apps/api/src/kernel/jobs.ts`: `createJobScheduler({ connectionString, log })` — pg-boss instance with `schedule: true`; `schedule(name, cron, handler)`; started/stopped from composition root.
- Tests: `apps/api/test/communication/abuse.test.ts` proves each guard FIRES (typed errors, alert rows) and each pass-path works.

### Task 5: Identity OTP hardening + real-channel integration

**Files:**
- Modify `apps/api/src/modules/identity/otp-sender.ts`: before sending — `assertChannelEnabled` per channel (whatsapp killed → try sms; both killed → OTP_DELIVERY_FAILED/CHANNEL_DISABLED), `assertDestinationAllowed(phone)`, `assertSendRate(phone)` (existing per-phone policy retained), budget spend per channel used. Signature gains optional `{ ip?, deviceId? }` context → `assertSendRate` for ip/device scopes when present.
- Modify `apps/api/src/modules/identity/auth.ts` + `index.ts`: thread request IP (`x-forwarded-for`/socket) and `x-device-id` header into `sendOtp` via better-auth hook context.
- Tests `apps/api/test/identity/otp.test.ts` (extend; existing assertions untouched): per-IP limit fires; per-device limit fires; kill-switch (whatsapp) → SMS fallback used; both killed → typed refusal; non-IQ destination → denied; WhatsApp-first/SMS-fallback e2e against adapter interface still green.

### Task 6: Communication module

**Files (apps/api/src/modules/communication/):**
- `templates.ts`: template registry over `@mesomed/i18n` catalogs. Message keys `communication.<template>.<variant>` where template ∈ `booking_confirmation | reschedule_notice | cancellation_notice | reminder | prescription_issued | subscription_activated | subscription_expired`, variant ∈ `sms` (shared by whatsapp/sms), `push.title`, `push.body`, `email.subject`, `email.body`. Params `{doctorName, dateTime, locationName}` (booking set); prescription: `{doctorName}`; subscription: `{}`/dates. `renderTemplate(template, variant, locale, params)` ports rev01 semantics (unknown locale → ckb; missing params left visible). rev01 sms bodies ported verbatim to catalogs.
- `shared.ts`: channel router `resolveDeliveryPlan(db, { patientProfileId })` → re-reads contact PII at send time via published queries; returns `{ locale, deliveries: [{channel, destination}] }` — push when token+pref, else whatsapp/sms phone, plus email when present+pref.
- `commands/plan-notification.ts`: `planNotification(tx, {...})` inserts `notification_log` pending row(s) with `dedupeKey` = `${template}:${appointmentId ?? aggregate}:${channel}` `ON CONFLICT DO NOTHING`.
- `events/on-booking-events.ts`: subscribers for `booking.booked/rescheduled/cancelled.v1` — id-only consumption; re-read patient contact + doctor/location display names via published queries; plan rows.
- `events/on-billing-events.ts`: `billing.subscription_activated/expired.v1` → provider email notification rows.
- `events/on-prescription-issued.ts`: `clinical.prescription_issued.v1` → patient notification, **no clinical content** (doctor name only).
- `sender.ts`: `createNotificationSender({ db, config, log, channels: { whatsapp, sms, push, email }, pollIntervalMs, maxAttempts, backoffSeconds })` — poll pending rows due (`status='pending' and next_attempt_at <= now`, indexed), for each: abuse guards (kill-switch, allowlist for phone channels, budget) → denied rows marked `denied` with reason; send via adapter; success → `sent` + metrics + velocity hook; failure → attempts+1, backoff, `failed` after maxAttempts, error recorded (redacted logger). Push token invalid → mark token dead (delete) and re-plan fallback channel row.
- `queries/notification-feed.ts` (ops/read; minimal), `commands/register-device-token.ts`, `commands/channel-preferences.ts` (+ `queries/channel-preferences.ts`).
- `router.ts`: `communication.registerDeviceToken` (authenticated), `communication.setChannelPreferences` (authenticated), `communication.getChannelPreferences` (authenticated). Zod I/O in `packages/contracts/src/communication.ts`.
- `reminders.ts`: `planNextDayReminders(db, now)` — booking published query `listRemindableAppointments(db, fromUtc, toUtc)` (new, in booking/queries, uses new index, statuses booked|confirmed) → plan `reminder` rows (dedupe key `reminder:{appointmentId}:{channel}`). Registered as pg-boss cron `communication-reminders` (env `REMINDER_CRON`, default `0 6 * * *`).
- `index.ts`: `registerCommunicationSubscribers({ events, ... })`.
- New published queries in owning modules: identity `queries/patient-contacts.ts` (`getPatientContact(db, patientProfileId)` → `{ normalizedPhone, fullName, email, userId }`), identity provider contact for billing notices; directory `queries/doctor-display-names.ts`; scheduling `queries/location-names.ts`.
- Mount router in `trpc/router.ts`; register subscribers + sender + cron in `app.ts`.

**Tests (apps/api/test/communication/):** templates (ported + variants ×3 locales; every key exists in all catalogs), dispatch e2e (book → confirmation row → sender delivers via mock whatsapp for guest; account patient with device token → push), email-killed gate test (email adapter failing → push delivered; email row attempts>1 then failed, error logged), reminder idempotency (run planner twice → one row; cron job registered), router contract + authz-denial + invariant tests, PII test (communication tables contain no fullName; log redaction), channel-mix metric recorded per send.

### Task 7: AI module

**Files:**
- `packages/domain/package.json`: add `"./ai": "./ai/index.ts"` + create `packages/domain/ai/index.ts` re-exporting utils + rate-limit.
- `apps/api/src/modules/ai/triage-service.ts`: port of the deferred pipeline — sanitization + deterministic red-flag first; AiGateway (Zod-parse via ported `parseTriageResponse`); whitelist intersection vs active DB specialties (directory published query `queries/triage-taxonomy.ts`: active specialties + symptom keyword entries); keyword fallback; 8s timeout inside gateway call; **no symptom text in logs, no free-text output returned** (slugs + boolean only); prompt delimiting preserved.
- `apps/api/src/modules/ai/router.ts`: `ai.triageSymptoms` **mutation** (body-only — GET query strings land in access logs; deliberate PII posture), public. Rate limits before any work: per-user (session) or per-IP token bucket AND separate global bucket via `@mesomed/domain/ai` `checkRateLimit` with `ai.triage_rate_policy` config → RATE_LIMITED / AI_QUOTA_EXCEEDED distinct.
- Delete `symptom-triage-service.ts.deferred-phase7` (superseded by the port).
- Contracts: `packages/contracts/src/ai.ts` (input: text 1–1000 chars; output `{ redFlag, specialties (≤3 slugs), engine }`).
- Wire `AiGateway` in composition root (mock default; anthropic when `ANTHROPIC_API_KEY`).

**Tests (apps/api/test/ai/):** provider-killed → fallback serves (gate); red-flag pre-screen unconditional (even with gateway wired); malformed model output → fallback; whitelist intersection (model returns non-DB slug → dropped); per-user and global rate limits BOTH fire independently; contract test; symptom-text-never-logged test (capture logs during triage incl. failure paths → assert text absent).

### Task 8: Composition root, env, mock-production guardrail

- `env.ts`: optional `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_BASE_URL` (default Meta), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `RESEND_API_KEY`, `RESEND_FROM`, `EXPO_PUSH_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `AI_TRIAGE_MODEL`, `REMINDER_CRON` (default `0 6 * * *`), `NOTIFICATION_POLL_INTERVAL_MS`, `NOTIFICATION_MAX_ATTEMPTS`, `NOTIFICATION_RETRY_DELAY_S`. `.env.example` updated.
- `app.ts`: build adapter set from env (real when creds present, mock otherwise); **before any I/O**: if `NODE_ENV==="production"` and any wired adapter `isMock` → throw (guardrail). Overrides seam extended (`notifyChannels`, `pushChannel`, `aiGateway`, `emailChannel` reused). Wire sender loop + job scheduler start/stop in onClose.
- Meta-test `apps/api/test/mock-production-guard.test.ts`: `buildServer(prodEnv)` with missing creds rejects naming the mock adapter; with all creds present (fake values) boots past the guard (then closed before listening; DB from harness).

### Task 9: Runbooks + ADR + amendment log

- `docs/runbooks/secrets-rotation-meta-whatsapp.md`, `secrets-rotation-twilio-sms.md`, `secrets-rotation-resend.md`, `secrets-rotation-anthropic.md` — rotation steps, blast radius, env var names, zero-downtime rotation order.
- `docs/adr/0011-phase7-communication-ai.md` (confirm number on disk first): decisions/deviations; mock→real flip checklist output (secrets not in repo/logs, rate limits proven, abuse cases tested, kill-switch proven — with test names as evidence); notification_log retention 12–24 months + crypto-shred columns; open items: MM-DEC rev03 pending; F-07 identity-event PII posture pending; F-09 provenance labeling before prescribing UI; SMS provider choice (Twilio-shaped adapter, provider swap = adapter+config); locale source decision (user_channel_preferences.locale, default ckb).
- `MM-PLAN-001-Execution-Plan.md` §6 amendment log: ADR index += 0011.

### Task 10: Gate run + PR

- `pnpm lint && pnpm typecheck` (turbo, all packages), `pnpm turbo test -- --concurrency=1` per memory note (zero failures; count > 700 baseline, all baseline suites intact), `pnpm build`.
- Push branch (gh.exe with --repo per memory), open PR with gate evidence. STOP — no merge, no Phase 8.

## Self-Review notes
- Every prompt scope item maps: communication module (T6), adapters (T3), abuse controls (T1/T4/T5/T6 tests), PII discipline (T2 comments, T4 redaction, T6 id-only subscribers), AI module (T7), runbooks (T9), mock→real checklist (T9), gate criteria (T6/T7/T8 tests + T10).
- Reminder scan uses new `(status, starts_at)` index — no unbounded per-row scan.
- OTP flow: MM-DEC rev02 exactly; no step-up added (rev03 = ADR open item only).
