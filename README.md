# MesoMed

Healthcare platform for Iraq/Kurdistan: doctor, hospital, laboratory, pharmacy
and home-nursing discovery, appointment booking, and clinical records —
trilingual (ckb default / ar / en), web + mobile.

**Architecture:** event-driven modular monolith — a single Fastify + tRPC BFF
(`apps/api`) with vertical-slice modules, pragmatic CQRS and a transactional
outbox on Postgres. Web and mobile are thin clients. The governing documents,
in order of authority:

1. [MM-PLAN-001](MM-PLAN-001-Execution-Plan.md) — locked stack, layout, conventions, phases and gates
2. [MM-DEC — Auth & Identity Strategy](MM-DEC-Authentication-and-Identity-Strategy-Locked-rev01.md)
3. [CLAUDE.md](CLAUDE.md) — session rules for AI-assisted work (conventions verbatim)
4. [docs/adr/](docs/adr/) — one ADR per locked decision
5. [MM-QA-001](MM-QA-001-Phase0-Architecture-Audit.md) — Phase 0 architecture audit

**Status:** Phase 0 (Foundation) complete, including the MM-QA-001 pre-Phase-1
remediation. Phase 1 (Kernel) is next. No business modules exist yet.

## Prerequisites

- Node 22 (`.nvmrc`), pnpm 11 (`corepack enable` or `npm i -g pnpm@11`)

## Quickstart

```sh
pnpm install
pnpm dev          # api + web + mobile dev servers via turbo
```

| Process       | Port | URL                          |
| ------------- | ---- | ---------------------------- |
| API (Fastify) | 4000 | http://localhost:4000/health |
| Web (Next.js) | 3000 | http://localhost:3000        |
| Mobile (Expo) | 8081 | via Expo Go / simulator      |

Environment variables are Zod-validated; see `.env.example` in each app.
Sentry and OpenTelemetry no-op when their env vars are unset — no accounts or
collectors needed for local work.

## Scripts

```sh
pnpm build          # all packages/apps
pnpm test           # unit + integration + guardrail meta-tests
pnpm lint           # includes module-boundary enforcement (see below)
pnpm typecheck
pnpm format:check   # prettier (enforced in CI)
```

## Guardrails (do not bypass)

The architecture's conventions are mechanically enforced, and every guardrail
has a meta-test proving it actually fires (a lesson recorded in MM-QA-001):

- **Module isolation** (MM-PLAN-001 §3.1) — `eslint-plugin-boundaries`;
  proven by `tooling/eslint-config/test/boundaries.test.ts`
- **Adapter discipline** (§3.8) — `no-restricted-imports` on
  `@mesomed/platform/adapters/*`; same meta-test
- **Telemetry actually exports spans** — `apps/api/test/otel.test.ts` runs the
  built artifact against a mock OTLP collector
- **CORS allowlist + error-code contract** — `apps/api/test/cors.test.ts`,
  `apps/api/test/errors.test.ts`

CI (GitHub Actions) runs lint → typecheck → test → build → format check and a
Docker image build on every PR and push to `main`. Phase gates are defined in
MM-PLAN-001 §5 — never start phase N+1 on a red gate.
