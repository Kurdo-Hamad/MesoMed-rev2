# ADR-0002 — Pre-Phase-1 Remediation of MM-QA-001 Findings

**Status:** Accepted
**Date:** 2026-07-09
**Phase:** 0 — Foundation (remediation batch; Phase 1 not started)

## Context

The independent Phase 0 architecture audit (MM-QA-001) found two Critical and
three High findings, with a single unifying theme: **false assurance** —
mechanisms that existed and looked correct but demonstrably did nothing (an
inert module-boundary lint rule, an OTel bootstrap that exported zero spans, a
"CI green" gate on a repository with zero commits). This ADR records the
decisions made while closing all pre-Phase-1 findings.

## Governing principle adopted

**Every guardrail ships with a meta-test proving it fires.** A guardrail whose
function is never demonstrated is indistinguishable from no guardrail (the same
failure mode that MM-PLAN-001 §3.6 cites for rejecting full-schema RLS).
Concretely:

- `tooling/eslint-config/test/boundaries.test.ts` lints committed violation
  fixtures and fails if they stop being rejected (or if allowed patterns start
  being rejected).
- `apps/api/test/otel.test.ts` runs the built artifact against a mock OTLP
  collector and fails unless real spans arrive and SIGTERM exits 0.
- `apps/api/test/cors.test.ts` / `errors.test.ts` pin the CORS allowlist and
  the error-code contract.

## Decisions

1. **Module-boundary enforcement (F-01).** `eslint-plugin-boundaries` v7
   syntax (`boundaries/dependencies` + `policies` + object selectors), element
   patterns relative to the linted package root, and
   `eslint-import-resolver-typescript` so NodeNext `.js`-suffixed TS imports
   classify. Policies: module↛module and kernel↛module (value imports; type-only
   imports allowed). §3.8 adapter discipline is enforced separately as a
   specifier-based `no-restricted-imports` ban on `@mesomed/platform/adapters/*`
   in the base config (applies to every package, incl. web/mobile/domain),
   lifted only for the apps/api composition root (`src/app.ts`,
   `src/composition/**`). Convention fixed hereby: **concrete adapters live
   under `@mesomed/platform/adapters/<name>`; interfaces at the package root.**
2. **Telemetry bootstrap (F-03/F-11).** `src/main.ts` is the process entry; it
   `await import()`s `instrumentation.ts` (OTel SDK + Sentry init,
   `OTEL_SERVICE_NAME` default `mesomed-api`) **before** the server chunk, so
   module-load hooks exist before fastify/pino/`node:http` are first required.
   The OTLP exporter is constructed without a manual `url` — env-var
   auto-configuration appends per-signal paths. Sentry gets
   `setupFastifyErrorHandler` in the app factory and `Sentry.close()` on
   shutdown. Verified: spans arrive (previously zero).
3. **Composition root (F-05).** `buildServer(env)` in `src/app.ts` constructs
   the real application with no listening/telemetry/process side effects;
   `server.ts` is a thin entry with hardened shutdown (idempotent, 10s
   force-exit timer, correct exit codes, telemetry flush — F-12). All tests
   consume `buildServer`, not a copy of the wiring.
4. **CORS and cookie posture (F-04).** `@fastify/cors` with an explicit
   env-driven allowlist (`CORS_ORIGINS`) and `credentials: true`. Wildcards and
   origin reflection are forbidden: Phase 2 introduces Better Auth cookie
   sessions, and reflected-origin + credentials is an authenticated-CSRF
   surface. The Phase 2 session design must revisit SameSite posture explicitly.
5. **Error model (F-07).** Handlers throw `AppError`; a middleware on the base
   procedure re-wraps them as mapped `TRPCError`s (NOT_FOUND→404 etc.); the
   formatter preserves canonical `data.code` and adds `data.appCode`
   (`contracts/errors` remains the single source of app codes, incl. the
   class — F-19 revisit deferred to Phase 1 kernel).
6. **Ports (F-06).** API defaults to **4000**; web keeps Next's 3000; Expo
   keeps 8081. Client fallbacks updated; `.env.example` files document
   overrides including the Expo physical-device case.
7. **i18n interim (F-10).** The hello-screen strings moved into the trilingual
   catalogs; web `<html>` lang/dir derive from `defaultLocale` (ckb → RTL by
   default). next-intl/use-intl adoption remains deferred to Phase 8
   (recording the deviation ADR-0001 omitted).
8. **Docker runtime (F-08).** Runner stage now receives only `dist/` plus a
   `pnpm deploy --prod --legacy` dependency tree (no devDependencies; verified
   133 MB vs full workspace install, boots and serves /health). `--legacy`
   because the workspace intentionally doesn't use injected packages (hoisted
   linker, ADR-0001 §6). Toolchain pinned (pnpm 11.10.0 / turbo 2.10.4),
   `HEALTHCHECK` added, `--enable-source-maps` set, port 4000.
9. **CI (F-09).** `permissions: contents: read`; `format:check` step; a
   `docker build` job so the deployment artifact cannot rot. Known accepted
   gap: web/mobile have no test scripts and mobile has no build task — turbo
   skips absent scripts, so green CI does not yet exercise an `expo export`
   (revisit by Phase 9); actions remain tag-pinned until the Phase 10 security
   pass (F-09e).
10. **Task graph (F-14).** `lint`/`typecheck` no longer depend on `^build`
    (internal packages ship raw TS); `@mesomed/api#test` depends on its own
    `build` because the OTel meta-test executes `dist/main.js`.
11. **TypeScript config (F-15).** Root solution `tsconfig.json` deleted
    (nothing ran `tsc -b`; false affordance). Vestigial
    `composite`/`declaration`/`incremental` dropped from the shared base.
    Mobile gains `noUncheckedIndexedAccess`/`noImplicitOverride`, closing its
    strictness gap.
12. **Phantom-dependency guard (F-17).** `import-x/no-extraneous-dependencies`
    in the base config (dev-dependency allowance for tests and config files) —
    compensates for `node-linker=hoisted` resolving undeclared imports until
    the prod-pruned image explodes.
13. **Repository governance (F-02/F-16).** `.claude/settings.local.json`
    gitignored; scaffold committed; remote created and pushed; the Phase 0
    gate is only considered met by an actual green GitHub Actions run.

## ADR-0001 errata (F-21)

- §4 described the API build as a "single self-contained `dist/server.js`" —
  inaccurate: third-party dependencies are intentionally external and resolve
  from `node_modules` (hence decision 8). The entry is now `dist/main.js` plus
  chunks.
- Phase 0 web deliberately ships without Tailwind v4 / shadcn/ui / next-intl
  (locked-stack items): deferred to Phase 8, recorded here.

## Deferred (unchanged from MM-QA-001)

Liveness/readiness split (F-13 — Phase 1 kernel), event-name branding + event
registry (F-20 — Phase 1), SHA-pinned actions / turbo remote cache (F-09e/f —
Phase 10 / when CI minutes hurt), `AppError` placement revisit (F-19 —
Phase 1).
