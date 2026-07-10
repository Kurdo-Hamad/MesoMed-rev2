# MM-PLAN-001 — MesoMed Rebuild Execution Plan (Locked Stack)

**Status:** Ready for execution with Claude Code
**Supersedes:** ChatGPT transformation proposal (adopted with modifications noted inline)
**Architecture:** Event-Driven Modular Monolith · Vertical Slice · Pragmatic CQRS · Transactional Outbox · Single BFF
**Explicitly rejected:** Event sourcing, microservices, separate web/mobile BFFs, Redis at launch, NestJS

---

## 1. Locked Stack

| Layer                  | Decision                                                                                                              | Notes                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo               | **Turborepo + pnpm workspaces**                                                                                       | Node 22 LTS, TypeScript strict everywhere                                                                                                      |
| API service            | **Fastify + tRPC v11**                                                                                                | Single deployable BFF; tRPC routers per module; REST added later only if a public API is needed                                                |
| Validation / contracts | **Zod v4** in `packages/contracts`                                                                                    | Single source of truth for API, events, config                                                                                                 |
| Database               | **PostgreSQL 16 (Supabase-hosted, infrastructure only)**                                                              | Zero Supabase SDK in domain code; access via Drizzle only                                                                                      |
| ORM / migrations       | **Drizzle ORM + drizzle-kit**                                                                                         | Carries over existing team knowledge                                                                                                           |
| Auth                   | **Better Auth** (Drizzle adapter, sessions in Postgres)                                                               | Patients: phone+password OTP-verified signup; Providers: email+password + verified email. Persistent sessions, Expo plugin, passkeys plugin later. Implements MM-DEC rev02 exactly |
| Jobs / events dispatch | **pg-boss** (Postgres-backed)                                                                                         | Outbox polling, reminders, retries. No Redis dependency                                                                                        |
| Web                    | **Next.js (latest stable, App Router) + Tailwind v4 + shadcn/ui + TanStack Query + tRPC client**                      | Thin client: no business logic, no direct DB access                                                                                            |
| Mobile                 | **Expo (latest SDK) + Expo Router + NativeWind 4 + Reanimated + TanStack Query + tRPC client**                        | EAS Build + EAS Update; expo-secure-store; expo-local-authentication (biometrics); expo-notifications (push)                                   |
| i18n                   | **Shared ICU catalogs in `packages/i18n`** — next-intl (web), use-intl (mobile)                                       | en / ar / ckb; ckb default; RTL via logical properties + `dir`                                                                                 |
| Design system          | **`packages/ui-tokens`** — Tailwind theme tokens consumed by web + NativeWind                                         | One brand definition, two renderers                                                                                                            |
| AI                     | **Vercel AI SDK (`ai`)** behind `AiGateway` adapter                                                                   | Anthropic default; provider swap = config. Deterministic keyword fallback preserved                                                            |
| Search                 | **Postgres FTS + pg_trgm** behind `SearchAdapter`                                                                     | Meilisearch adapter when listing volume demands it — not before                                                                                |
| Storage                | **S3-compatible adapter** → Supabase Storage now                                                                      | Any S3 later with zero domain change                                                                                                           |
| Email                  | **Resend** behind `EmailChannel` adapter                                                                              |                                                                                                                                                |
| Push                   | **Expo Push Service** behind `PushChannel` adapter                                                                    | Primary notification channel per MM-DEC                                                                                                        |
| WhatsApp               | **Meta WhatsApp Cloud API** adapter (Phase 2 mock, Phase 7 real)                                                      | Patient registration OTP verification (preferred), account recovery, guest booking notifications. Mock provider in Phase 2; real integration in Phase 7.                                     |
| SMS                    | **Recovery + fallback-notification adapter**                                                                          | Patient and provider password recovery; guest booking notifications when push unavailable                                                     |
| Payments               | **PaymentOrchestrator** module: `manual` (launch), FIB + ZainCash adapters (post-launch)                              | Routing table in DB config: country × category × gateway                                                                                       |
| Observability          | **pino + OpenTelemetry (OTLP)** + **Sentry** (api/web/mobile)                                                         | Any OTLP backend; start Grafana Cloud free tier                                                                                                |
| Rate limiting          | **@fastify/rate-limit, in-memory** (single instance at launch)                                                        | Redis store swapped in only when horizontally scaling                                                                                          |
| Testing                | **Vitest** (unit) · **Testcontainers/pg service** (integration) · **Playwright** (web e2e) · **Maestro** (mobile e2e) |                                                                                                                                                |
| CI/CD                  | **GitHub Actions**; API as **Docker image** → Railway/Fly (eu-central); web → Vercel                                  | Dockerfile in repo = deployment portability                                                                                                    |
| Docs                   | `/docs/adr/` — every locked decision gets an ADR                                                                      | ADR-0001 = this stack                                                                                                                          |

---

## 2. Repository Layout

```
mesomed/
├── apps/
│   ├── api/                  # Fastify + tRPC modular monolith (the platform)
│   ├── web/                  # Next.js thin client
│   └── mobile/               # Expo app
├── packages/
│   ├── contracts/            # Zod: API I/O schemas, event contracts (versioned), error codes
│   ├── db/                   # Drizzle schema (re-export hub), client factory, migrations
│   ├── domain/               # PURE logic only: state machines, slot engine, tier rules, triage utils
│   ├── config/               # Country/category/policy config: Zod schema + loader + DB-backed store
│   ├── platform/             # Adapter interfaces + implementations: ai, search, storage, email, push, whatsapp, payments
│   ├── i18n/                 # en.json, ar.json, ckb.json (ICU)
│   └── ui-tokens/            # brand tokens (colors, radii, shadows, type scale)
├── tooling/                  # shared eslint, tsconfig, prettier
├── docs/adr/
├── turbo.json
└── CLAUDE.md
```

### API internal structure (vertical slices)

```
apps/api/src/
├── modules/
│   ├── identity/        # Better Auth mount, roles, RBAC, guest patient profiles, account claim
│   ├── directory/       # providers, doctor profiles, facilities, taxonomy, promotions, countries/cities
│   ├── scheduling/      # locations, weekly schedules, breaks, blocked slots, slot generation
│   ├── booking/         # appointments, lifecycle state machine, guest booking
│   ├── clinical/        # encounters, visit notes, append-only audit, support-access grants
│   ├── billing/         # subscriptions, listing tiers, payment orchestrator
│   ├── communication/   # notification dispatch, templates, channel routing, preferences
│   ├── search/          # search read models, indexing subscribers
│   ├── ai/              # triage endpoint, AiGateway consumption
│   └── admin/           # verification, taxonomy admin, audit views
├── kernel/              # outbox writer/dispatcher, event bus, config service, authz, errors, otel
└── server.ts
```

Per-module convention: `commands/` · `queries/` · `events/` (subscribers) · `router.ts` (tRPC) · `schema.ts` (Drizzle tables **owned exclusively by this module**).

---

## 3. Non-Negotiable Conventions (goes into CLAUDE.md)

1. **Module data isolation:** a module writes only its own tables. Cross-module writes happen via domain events. Cross-module reads happen via published query functions or dedicated read views — never raw joins into another module's tables from command code.
2. **Pragmatic CQRS:** commands mutate + emit events in one transaction (outbox row written in the same tx). Queries read freely, may use denormalized views. No event sourcing — Postgres rows are the source of truth; events are integration signals.
3. **Event contracts are forever:** every event has `{ name, version, payload }` Zod schema in `packages/contracts/events`. Additive changes only; breaking change = new version, old handlers kept until drained.
4. **Consistency classification:** booking slot allocation and clinical writes = strongly consistent (single tx + partial unique index on non-cancelled appointments — port from current schema). Directory, search, feeds, notifications = eventually consistent via outbox.
5. **Clinical integrity:** `clinical_access_log` append-only, populated by SECURITY DEFINER Postgres trigger (port concept from current 0002 migration). Visit notes: corrections are amendments, never UPDATEs to content. Admin access only via time-boxed support grants.
6. **Two-layer authorization + clinical-tier RLS:** (a) role check in kernel authz middleware per procedure; (b) resource-ownership check inside command/query handlers. DB role for the API is least-privilege (no superuser/owner in production). Full-schema RLS is rejected — it protects a path the app doesn't use and creates false assurance (proven failure mode in the current codebase: 130 assertions guarding an unused path). Exception: `encounters` and `visit_notes` carry targeted RLS policies as defense-in-depth against API-layer bugs (deny-all direct select, access only via SECURITY DEFINER support-access function) — cheap, high-value, applied to clinical tables only.
7. **Patient identity continuity:** guest bookings create internal patient profiles keyed on normalized phone number (unverified). Account registration claims existing profile by: (a) phone match + OTP-verified phone ownership, or (b) phone match + verified email. Merge is atomic; no unverified claim step exists. Merge policy is a domain rule in `identity`.
8. **Adapters:** domain/module code imports interfaces from `packages/platform` only. Concrete providers are wired in `apps/api` composition root via env/config. Second adapter is built when the second provider is real — never speculatively.
9. **Config over code:** countries, enabled categories, gateways, channels, tier pricing = rows in config tables validated by `packages/config` schemas. Adding a country must not require code changes to existing modules.
10. **i18n:** every user-facing string in catalogs from day one. No hardcoded strings. RTL logical properties only (`ps/pe/ms/me/start/end`).
11. **Errors:** typed error codes in `contracts/errors`; tRPC error formatter maps them; clients never parse message strings.
12. **Testing DoD per slice:** unit tests for pure domain logic, integration test per command (happy + authz-denial + invariant-violation), contract test that router I/O matches Zod schemas. CI green before next slice starts.
13. **No `any`, no `ts-ignore`, no barrel-file cycles.** ESLint boundaries rule enforces module import constraints (`eslint-plugin-boundaries`).
14. **Every phase ends with an ADR** recording what was decided/deviated.

---

## 4. Salvage Manifest (port from current repo — code, not just concepts)

| Asset                                                                                                         | Destination                                                                 |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `appointments/transitions.ts` + tests                                                                         | `packages/domain/booking/`                                                  |
| `locations/slots.ts`, `availability-week.ts` + tests                                                          | `packages/domain/scheduling/`                                               |
| `billing/tier-utils.ts` + tests                                                                               | `packages/domain/billing/`                                                  |
| `provider/facility-cursor.ts` + tests                                                                         | `packages/domain/directory/`                                                |
| `provider/symptom-triage-utils.ts` + tests (red-flag list, sanitization, prompt delimiting, keyword fallback) | `packages/domain/ai/`                                                       |
| `notifications/templates.ts` + tests                                                                          | `communication` module (extended: push + email variants)                    |
| `messages/en.json, ar.json, ckb.json`                                                                         | `packages/i18n` (restructured keys allowed)                                 |
| Seed pipeline (4 scripts, 1,466 lines)                                                                        | `apps/api/scripts/seed/` (adapted to new schema)                            |
| Clinical audit trigger SQL (migration 0002 concept)                                                           | new migration in `packages/db`                                              |
| Double-booking partial unique index                                                                           | new booking schema                                                          |
| Trilingual red-flag keyword list                                                                              | unchanged                                                                   |
| DB schema shapes (29 tables)                                                                                  | reference for new per-module schemas — redesign where events/config require |

Everything else (auth flow, RLS harness, Supabase SSR clients, server actions, middleware, current UI) is **not ported**.

---

## 5. Execution Phases

Solo + Claude Code. Each phase = one or more Claude Code working sessions with the acceptance gate as the stop condition — **the gate, not the calendar, controls sequencing.** Phase N+1 never starts on a red gate, regardless of elapsed time. Week numbers below are sequencing estimates for planning purposes only, not commitments; total sequencing estimate spans roughly 26–32 weeks of equivalent effort, with API+web reaching a launchable state around the two-thirds mark.

### Phase 0 — Foundation (Week 1)

- Scaffold Turborepo: `apps/api|web|mobile`, all `packages/*`, `tooling/*`.
- TypeScript strict, ESLint (+boundaries), Prettier, Vitest wiring, turbo pipeline.
- `apps/api`: Fastify boot, health endpoint, pino, OTel bootstrap, Sentry, env schema (Zod-validated `process.env`).
- Dockerfile (api), GitHub Actions: lint → typecheck → unit → build on PR.
- `CLAUDE.md` written with §3 conventions verbatim.
- **Gate:** `pnpm build && pnpm test` green in CI; API container runs locally; web+mobile boot to hello screens.

### Phase 1 — Kernel (Weeks 2–3)

- `packages/db`: Drizzle client factory, migration runner, test-DB harness (Testcontainers + CI pg service).
- Outbox: `domain_events` table (id, name, version, aggregate_type, aggregate_id, payload jsonb, occurred_at, published_at, attempts); kernel `emit()` writes in-tx; pg-boss dispatcher with retry + dead-letter status; idempotent handler registry.
- Kernel: authz middleware (role guard), typed error model, config service (config tables + Zod-validated loader + cache), request-scoped context (session, locale, country).
- tRPC root router + Zod integration + error formatter.
- **Gate:** integration test proves: command tx writes row + outbox atomically → dispatcher delivers to subscriber exactly once under retry; a poisoned event lands in dead-letter.

### Phase 2 — Identity (Weeks 4–6)

- Better Auth mounted on Fastify: email+password, email verification (Resend), persistent sessions (no OTP on login — MM-DEC §4), session revocation, roles table (patient/doctor/secretary/admin) + permission map.
- Guest patient profiles: create-on-booking (name, phone required, DoB/gender/email optional) — MM-DEC §1.
- Account claim flow: registration links existing guest profile by phone + verified email — MM-DEC §2.
- Provider accounts mandatory + WhatsApp-OTP recovery stub interface (adapter lands Phase 7) — MM-DEC §3/§5.
- Admin manual recovery command with audit event.
- Events: `identity.user_registered.v1`, `identity.role_assigned.v1`, `identity.patient_profile_created.v1`, `identity.profile_claimed.v1`. OTP verification (WhatsApp→SMS) at patient account creation, keyed to phone-ownership proof.
- OtpChannel adapter interface (mock/log provider Phase 2, real Meta WhatsApp Cloud API + SMS Phase 7).
- **Gate:** full auth integration suite (register, verify, login, revoke, claim, role guards on protected procedures); mobile session persistence verified with Better Auth Expo plugin + secure store.

### Phase 3 — Directory + Taxonomy + Search (Weeks 6–9)

- Schemas: countries, cities, categories, specialties, symptoms, symptom-specialty map, procedures, providers, doctor_profiles, facilities, facility media/sections, promotions.
- Config-driven country gating (`coming_soon`) via `packages/config`.
- Queries: directory browse (keyset pagination — port cursor logic), doctor/facility detail, homepage feed.
- Search module: FTS + trigram read models, refreshed by directory event subscribers (`directory.facility_updated.v1` etc.).
- Admin taxonomy commands.
- Seed pipeline adapted; ~200k-row perf validation re-run (port perf-explain approach).
- **Gate:** seeded directory browsable via tRPC with p95 < 100ms on 200k synthetic facilities; trilingual fields round-trip.

### Phase 4 — Scheduling + Booking (Weeks 9–12)

- Scheduling: practice locations, doctor_locations, secretary assignments, weekly schedules, breaks, blocked slots; slot generation from ported `packages/domain/scheduling` (Asia/Baghdad canonical, tz-aware for expansion).
- Booking: appointment aggregate + ported state machine; guest booking command (creates/links patient profile via identity event or query); secretary find-or-create booking; reschedule/cancel/confirm/check-in/start/complete/no-show commands, each role-gated.
- Invariants: double-booking partial unique index; slot-conflict check in-tx (strong consistency).
- Events: `booking.booked/confirmed/rescheduled/cancelled/completed/no_show.v1`.
- **Gate:** concurrency test — parallel bookings for the same slot yield exactly one success; full lifecycle integration tests per role.

### Phase 5 — Clinical (Weeks 12–14)

- Encounters (1:1 appointment, created by subscriber on `booking.completed.v1` — port current pattern), visit notes (append-only amendments model), audit trigger migration, time-boxed admin support-access grants.
- Targeted RLS on `encounters`/`visit_notes` (deny-all direct select; access only through SECURITY DEFINER support-access function) — defense-in-depth backstop, not the primary authz layer (see §3.6).
- **Gate:** audit rows produced by DB trigger for every read/write path; UPDATE/DELETE on audit log denied at DB level; amendment flow tested; support-access expiry enforced; RLS policy independently verified to block a raw connection attempt bypassing the API.

### Phase 6 — Billing + Payments (Weeks 14–16)

- Subscriptions (flat monthly, active/inactive/grace), listing tiers + prices + idempotent tier payments (port unique-key + period-tuple constraints), public-visibility rule as a directory read predicate driven by billing events.
- PaymentOrchestrator: `PaymentGateway` interface, routing config table, `manual` gateway complete; webhook endpoint with Zod validation + signature-verification interface + rate limit (fixes current gaps).
- Events: `billing.subscription_activated/expired.v1`, `billing.tier_payment_recorded.v1`.
- **Gate:** idempotency proven (duplicate webhook/payment replays are no-ops); visibility flips on subscription events without directory code changes.

### Phase 7 — Communication + AI (Weeks 16–18)

- Communication module: dispatch on booking/billing events via outbox; channel router (push primary, email secondary — MM-DEC §6); trilingual templates (ported + push/email variants); notification log; user channel preferences; next-day reminder as pg-boss cron.
- Push: Expo Push adapter + device-token registration procedure (mobile lands Phase 9; token API ready now).
- Email: Resend adapter (verification emails already live from Phase 2 — this generalizes the channel).
- WhatsApp Cloud API adapter (real implementation, replaces mock from Phase 2) for patient registration OTP, account recovery, and guest booking notifications.
- AI module: triage procedure via `AiGateway` (Vercel AI SDK, Anthropic default), red-flag pre-screen, whitelist intersection, deterministic fallback, rate limit — port full pipeline.
- **Gate:** kill the AI provider in a test → fallback serves; kill email adapter → push still delivers and failure is logged + retried; reminder cron idempotent.

### Phase 8 — Web App (Weeks 18–22) — **launchable milestone**

- Next.js thin client on tRPC: homepage (hero, category cards, recommended feed — implement the currently-stubbed featured-slot resolver properly), directory + detail pages (7 categories + home-nursing), search + symptom search, guest booking flow, auth screens, four role dashboards, admin suite.
- Premium pass: `packages/ui-tokens` applied, custom font via `next/font` (current app has none), image optimization via Next image pipeline with remote patterns (fixes `unoptimized` regression), skeletons/optimistic updates, Lighthouse ≥ 90 all categories, full RTL audit in ar/ckb.
- Security: CSP + security headers, CSRF posture documented (tRPC + same-site cookies), no current-app gaps carried forward.
- Playwright e2e: guest booking, provider signup→verification→visibility, admin tier payment.
- **Gate:** e2e suite green; Lighthouse budget met; RTL visual review signed off; deploy to production infra.

### Phase 9 — Mobile App (Weeks 22–28)

- Expo Router app: browse/search/detail, guest booking, optional account + biometric unlock (expo-local-authentication after first login — MM-DEC §4), patient dashboard, push registration + notification center, doctor/secretary queue views (phase 9b if needed).
- EAS Build profiles (dev/preview/prod), EAS Update channel strategy, store metadata (en/ar/ckb).
- Maestro flows: booking, login+biometric, push receipt.
- **Gate:** TestFlight + Play internal track builds; push round-trip verified on physical devices; offline-tolerant browsing (cached queries) verified.

### Phase 10 — Hardening + Launch (Weeks 28–32)

- Load test booking + directory (k6) at 10× expected launch traffic; index audit.
- Observability: dashboards for outbox lag, dead-letter depth, booking funnel, p95s; alerts on outbox lag + error rate.
- Security review: dependency audit in CI (npm audit + Dependabot + CodeQL), secrets scan, least-privilege DB role verification, backup/restore drill, data-retention + erasure procedure documented (crypto-shred columns for PII where audit immutability conflicts).
- Data migration script from old Supabase DB (patients, providers, facilities, appointments) if any production data exists at cutover.
- Launch checklist ADR; old codebase archived read-only.

---

## 6. Amendment Log

Earlier revisions of this log labeled the entries "ADR-0002"/"ADR-0003" as
logical decision numbers; the ADR files on disk diverged from that numbering
(`docs/adr/0002` is the pre-Phase-1 remediation batch), so entries now cite
where each decision actually lives (reconciled in ADR-0003, Phase 1).

- **Full-schema RLS rejected:** clinical-tier RLS (encounters, visit_notes) adopted as defense-in-depth, layered under the two-layer application authz model. Recorded in §3.6 and §5 Phase 5 of this plan (restated verbatim as CLAUDE.md convention #6); no standalone ADR file.
- **Phase week numbers reclassified** as sequencing estimates, not calendar commitments; gate criteria remain the sole condition for advancing phases. Recorded in the §5 preamble; no standalone ADR file.
- **ADR filename index** (`docs/adr/` is authoritative): `0001` locked stack & Phase 0 foundation · `0002` pre-Phase-1 remediation of MM-QA-001 findings · `0003` Phase 1 kernel.

## 7. Claude Code Kickoff Prompt (use verbatim for Phase 0)

```
Read CLAUDE.md fully before any work. You are building MesoMed per MM-PLAN-001.
Execute Phase 0 only. Scaffold the Turborepo exactly as specified in §2 of the plan
(pnpm, Node 22, TS strict). Wire tooling (eslint with boundaries plugin, prettier,
vitest), Fastify boot with pino + OTel + Sentry stubs + Zod-validated env, Dockerfile,
and the GitHub Actions pipeline (lint → typecheck → test → build). Web and mobile
apps boot to a hello screen consuming one tRPC healthcheck procedure through
packages/contracts. Do not implement any business module. Stop when the Phase 0
gate criteria pass and show me the verification output.
```

Then proceed phase by phase; never start phase N+1 with a red gate on phase N.

---

## 8. Deferred Until Justified (do not build now)

Meilisearch, Redis, FIB/ZainCash live integrations (post-launch), analytics platform, medical marketplace category, multi-region deployment, REST/OpenAPI public API, microservice extraction, MapLibre, passkeys UI, second AI provider adapter, doctor mobile app parity (9b).
