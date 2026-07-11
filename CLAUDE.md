# CLAUDE.md — MesoMed

This file governs every Claude Code session working in this repository. Read it fully before any work. The authoritative sources are:

- **MM-PLAN-001-Execution-Plan.md** — locked stack, repository layout, salvage manifest, phase-by-phase execution plan and acceptance gates.
- **MM-DEC-Authentication-and-Identity-Strategy-Locked-rev02.md** — the locked authentication/identity/notification strategy that Phase 2 (Identity) and the Better Auth integration implement exactly.

If anything in this file conflicts with MM-PLAN-001, MM-PLAN-001 wins — update this file to match, don't route around it.

## Architecture in one paragraph

Event-driven modular monolith, not microservices, not event sourcing. A single Fastify + tRPC BFF (`apps/api`) organized into vertical-slice modules that each own their own Postgres tables (via Drizzle). Commands mutate state and emit domain events transactionally (transactional outbox, dispatched by pg-boss); queries read freely via denormalized views. `apps/web` (Next.js) and `apps/mobile` (Expo) are thin clients — no business logic, no direct DB access, everything through typed tRPC procedures backed by Zod contracts in `packages/contracts`.

## Non-Negotiable Conventions

The following is §3 of MM-PLAN-001, verbatim. These are not suggestions — code that violates them should not be written, and a PR/diff that violates them should not be considered done.

1. **Module data isolation:** a module writes only its own tables. Cross-module writes happen via domain events. Cross-module reads happen via published query functions or dedicated read views — never raw joins into another module's tables from command code.
2. **Pragmatic CQRS:** commands mutate + emit events in one transaction (outbox row written in the same tx). Queries read freely, may use denormalized views. No event sourcing — Postgres rows are the source of truth; events are integration signals.
3. **Event contracts are forever:** every event has `{ name, version, payload }` Zod schema in `packages/contracts/events`. Additive changes only; breaking change = new version, old handlers kept until drained.
4. **Consistency classification:** booking slot allocation and clinical writes = strongly consistent (single tx + partial unique index on non-cancelled appointments — port from current schema). Directory, search, feeds, notifications = eventually consistent via outbox.
5. **Clinical integrity:** `clinical_access_log` append-only, populated by SECURITY DEFINER Postgres trigger (port concept from current 0002 migration). Visit notes: corrections are amendments, never UPDATEs to content. Admin access only via time-boxed support grants.
6. **Two-layer authorization + clinical-tier RLS:** (a) role check in kernel authz middleware per procedure; (b) resource-ownership check inside command/query handlers. DB role for the API is least-privilege (no superuser/owner in production). Full-schema RLS is rejected — it protects a path the app doesn't use and creates false assurance (proven failure mode in the current codebase: 130 assertions guarding an unused path). Exception: `encounters`, `visit_notes` and `prescriptions` (added by ADR-0010) carry targeted RLS policies as defense-in-depth against API-layer bugs (deny-all direct select, access only via SECURITY DEFINER support-access function) — cheap, high-value, applied to clinical tables only.
7. **Patient identity continuity:** guest bookings create internal patient profiles keyed on normalized phone number (unverified). Account registration claims existing profile by: (a) phone match + OTP-verified phone ownership, or (b) phone match + verified email. Merge is atomic; no unverified claim step exists. Merge policy is a domain rule in `identity`.
8. **Adapters:** domain/module code imports interfaces from `packages/platform` only. Concrete providers are wired in `apps/api` composition root via env/config. Second adapter is built when the second provider is real — never speculatively.
9. **Config over code:** countries, enabled categories, gateways, channels, tier pricing = rows in config tables validated by `packages/config` schemas. Adding a country must not require code changes to existing modules.
10. **i18n:** every user-facing string in catalogs from day one. No hardcoded strings. RTL logical properties only (`ps/pe/ms/me/start/end`).
11. **Errors:** typed error codes in `contracts/errors`; tRPC error formatter maps them; clients never parse message strings.
12. **Testing DoD per slice:** unit tests for pure domain logic, integration test per command (happy + authz-denial + invariant-violation), contract test that router I/O matches Zod schemas. CI green before next slice starts.
13. **No `any`, no `ts-ignore`, no barrel-file cycles.** ESLint boundaries rule enforces module import constraints (`eslint-plugin-boundaries`).
14. **Every phase ends with an ADR** recording what was decided/deviated.

## Repository layout

```
mesomed/
├── apps/
│   ├── api/                  # Fastify + tRPC modular monolith (the platform)
│   ├── web/                  # Next.js thin client
│   └── mobile/               # Expo app
├── packages/
│   ├── contracts/            # Zod: API I/O schemas, event contracts (versioned), error codes
│   ├── db/                   # Drizzle schema (re-export hub), client factory, migrations
│   ├── domain/                # PURE logic only: state machines, slot engine, tier rules, triage utils
│   ├── config/                # Country/category/policy config: Zod schema + loader + DB-backed store
│   ├── platform/              # Adapter interfaces + implementations: ai, search, storage, email, push, whatsapp, payments
│   ├── i18n/                  # en/ar/ckb message catalogs (ICU)
│   └── ui-tokens/              # brand tokens (colors, radii, shadows, type scale)
├── tooling/                    # shared eslint, tsconfig, prettier
├── docs/adr/
├── turbo.json
└── CLAUDE.md
```

`apps/api/src/modules/*` are vertical slices (identity, directory, scheduling, booking, clinical, billing, communication, search, ai, admin). Each module has `commands/ · queries/ · events/ · router.ts · schema.ts`, with tables **owned exclusively by that module** (see convention #1). Shared infra (outbox, authz, config service, errors, otel) lives in `apps/api/src/kernel`.

## Phase discipline

Execution proceeds phase by phase per MM-PLAN-001 §5. **The acceptance gate, not the calendar, controls sequencing** — never start phase N+1 on a red gate for phase N. Every phase ends with an ADR (`docs/adr/`) recording what was decided or deviated, per convention #14.

Phase 0 (Foundation) scaffolds the monorepo, tooling, and a health-check-only API/web/mobile — no business modules. Business logic starts at Phase 1 (Kernel/outbox) and Phase 2 (Identity, implementing MM-DEC exactly).

## Development environment (binding)

The WSL clone at `~/mesomed` is the only authoritative working copy. All builds,
tests, gate runs, commits, and Claude Code sessions execute from WSL. The
Windows-side checkout (`C:\Users\Lenovo\Documents\MesoMed.rev2`) is read-only
reference — never build, never test, never commit from it (precedent: a CRLF
incident corrupted a prior commit). If a session finds itself running the gate
or committing from a Windows path, stop and surface it before proceeding.
