# MM-QA-001 — Phase 0 Architecture Audit

**Project:** MesoMed (greenfield rebuild per MM-PLAN-001)
**Scope:** Phase 0 — Foundation. Architecture _and_ implementation.
**Auditor role:** Independent Principal Software Architect
**Date:** 2026-07-09
**Inputs read in full:** MM-PLAN-001-Execution-Plan.md · MM-DEC-Authentication-and-Identity-Strategy-Locked-rev01.md · CLAUDE.md · docs/adr/0001-locked-stack.md · every file in the repository
**Verdict:** **CONDITIONAL GO for Phase 1** — the foundation is structurally sound and matches the locked plan, but **two Critical and three High findings must be closed before Phase 1 (Kernel) begins.** None require redesign; all are days, not weeks.

---

## 1. Executive Summary

Phase 0 delivers what MM-PLAN-001 §5 asked for: a correctly shaped Turborepo matching §2 exactly, strict TypeScript everywhere, a Fastify + tRPC health-check API with Zod-validated env, hello screens on web and mobile consuming the health procedure through `packages/contracts`, a `turbo prune`-based Dockerfile, a CI pipeline, and an honest ADR recording every deviation. The full gate (`lint → typecheck → test → build`) was independently reproduced green from a clean `--frozen-lockfile` install on Linux during this audit.

However, this audit **empirically tested** the foundation's load-bearing claims rather than trusting them, and several claims do not survive contact:

1. **The architecture's single automated guardrail — the `eslint-plugin-boundaries` module-isolation rule — is completely inert.** A direct cross-module value import, the exact violation MM-PLAN-001 §3.1 exists to prevent, passes lint with exit code 0. Three independent defects each suffice to disable it. This was proven with a fixture experiment, and a corrected configuration was proven to fire. (F-01, Critical)
2. **The repository has zero commits, no remote, and CI has never executed.** The Phase 0 gate — "`pnpm build && pnpm test` green **in CI**" — has therefore never actually been met. Under the plan's own phase discipline ("never start phase N+1 on a red gate"), Phase 0 is not formally complete. (F-02, Critical)
3. **OpenTelemetry tracing exports nothing.** A live experiment against a fake OTLP collector showed zero trace exports across repeated instrumented-worthy requests (only pino log records arrived, via env-var auto-configuration). The SDK is started after the modules it must patch are imported, no ESM loader hook is registered, and the manually configured exporter URL would post to the wrong path even if spans existed. (F-03, High)
4. **The API has no CORS layer.** Verified: responses to cross-origin requests carry no `Access-Control-Allow-Origin` header, so the browser-based web client is blocked from reading any tRPC response. Only the native mobile client (exempt from CORS) can consume the API cross-origin. The gate claim "web boots to hello screen consuming one tRPC healthcheck" cannot have been true in a browser against a separate-origin API. (F-04, High)
5. **There is no composition root.** `apps/api/src/server.ts` performs env loading, telemetry init, app construction, and listening as import-time side effects. The integration test cannot import the real app and instead hand-duplicates the wiring — so the test suite verifies a _copy_ of the application, not the application. (F-05, High)

The common thread — and the most important lesson for an AI-assisted build — is **false assurance**: mechanisms that exist, look correct, and silently do nothing (boundaries rule, OTel, "CI green"). MM-PLAN-001 §3.6 explicitly names false assurance as the failure mode that justified rejecting full-schema RLS in the previous codebase ("130 assertions guarding an unused path"). Phase 0 has reproduced that failure mode in three new places. The corrective principle adopted throughout this report: **every guardrail must have a meta-test proving it fires.**

---

## 2. Verification Methodology

This audit did not modify any code in the repository. All experiments ran in an isolated copy under the session scratchpad:

| #   | Experiment                                                                                                                                            | Result                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | `git log` / `git remote` on the repo                                                                                                                  | **No commits exist; no remote configured.** CI has never run.                                                                                 |
| V2  | Fresh `pnpm install --frozen-lockfile` (clean Linux env, pnpm 11.10.0 — what CI would do)                                                             | Green in 2m23s; `allowBuilds` entries (esbuild, sharp, protobufjs) executed correctly.                                                        |
| V3  | `pnpm lint` / `typecheck` / `test` / `build` on the clean install                                                                                     | **All green** (11 lint, 11 typecheck, 3 test, 2 build tasks). The _code_ would pass CI.                                                       |
| V4  | Fixture: `src/modules/beta` performs a value import from `src/modules/alpha` internals; linted with the shipped config                                | **Exit 0 — no error.** The §3.1 guardrail is inert.                                                                                           |
| V5  | Same fixture with path-corrected patterns only                                                                                                        | Still exit 0; plugin emitted v5→v7 deprecation warnings (`element-types`→`dependencies`, `rules`→`policies`, legacy selectors, `importKind`). |
| V6  | Same fixture with a fully corrected v7 config + `.ts`-aware resolver + extensionless import                                                           | **Rule fires: 1 error, exit 1.** Type-only cross-module import still passes (correct per design intent).                                      |
| V7  | Built API run with `OTEL_EXPORTER_OTLP_ENDPOINT` pointed at a local fake collector; 6 requests to `/health` and `/trpc/health.check`; 9s flush window | **Zero `POST /v1/traces`.** Only `POST /v1/logs` (pino records via env-var auto-config). Tracing is non-functional.                           |
| V8  | `curl -H "Origin: http://localhost:3001"` against `/trpc/health.check`                                                                                | **No `Access-Control-Allow-Origin` header** in response. Browser clients are CORS-blocked.                                                    |

---

## 3. Area Scorecard

| Area                                           | Assessment                                                  | Key findings                                               |
| ---------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Repository structure                           | **Strong** — matches MM-PLAN-001 §2 exactly                 | F-15 (minor)                                               |
| Workspace organization / package boundaries    | **Sound design, broken enforcement**                        | **F-01 (Critical)**                                        |
| Dependency graph                               | Sound; one latent risk                                      | F-17 (phantom deps under hoisting)                         |
| Build system (turbo, tsup, raw-TS packages)    | Pragmatic, ADR-documented                                   | F-14 (graph inaccuracies)                                  |
| TypeScript configuration                       | **Strong** (strict + `noUncheckedIndexedAccess` everywhere) | F-15 (vestigial composite/references), mobile drift (F-15) |
| ESLint configuration                           | Base config good; **api boundary config inert**             | **F-01**                                                   |
| Fastify architecture                           | Minimal, correct for scope; no factory seam                 | **F-05 (High)**                                            |
| tRPC architecture                              | Correct wiring; error formatter flawed                      | F-07                                                       |
| Shared contracts                               | Correct pattern, minimal by design                          | F-19, F-20 (low)                                           |
| Environment configuration                      | Zod fail-fast: good; no `.env.example`                      | F-18                                                       |
| Docker                                         | Good pattern (prune, non-root); bloated runtime image       | F-08                                                       |
| GitHub Actions                                 | Correct shape; **never executed**; gaps                     | **F-02 (Critical)**, F-09                                  |
| Logging (pino)                                 | Working (verified via OTLP logs)                            | —                                                          |
| OpenTelemetry                                  | **Non-functional for traces (verified)**                    | **F-03 (High)**                                            |
| Sentry                                         | Init-only stub; won't capture request context               | F-11                                                       |
| Health endpoints                               | Fine for Phase 0; no readiness split                        | F-13                                                       |
| Testing strategy                               | Gate-minimal; tests verify a copy of the app                | **F-05**, F-09c                                            |
| Developer experience                           | Port collision, no README, no `.env.example`                | F-06, F-18                                                 |
| Security posture                               | No exposure yet; CORS decision pending is the real risk     | **F-04**, F-08, F-09d, F-16                                |
| i18n                                           | Catalogs exist; Phase 0 UI violates convention #10          | F-10                                                       |
| Scalability / maintainability / replaceability | Architecture choices remain correct                         | §6 discussion                                              |
| AI-assisted development readiness              | CLAUDE.md strong; guardrails must be machine-verified       | §7 discussion                                              |

---

## 4. Findings

Severity scale — **Critical:** an architecture invariant or phase gate is silently unmet. **High:** verified-broken core capability, or debt that corrupts subsequent phases. **Medium:** real debt, contained and cheap now. **Low:** hygiene.

---

### F-01 · CRITICAL — The module-boundary lint rule is completely inert (verified)

**Where:** `tooling/eslint-config/api.js`

**Explanation.** Convention §3.13 mandates `eslint-plugin-boundaries` as the enforcement mechanism for §3.1 (module isolation) and — per this file's own doc comment — §3.8 (adapter discipline). Experiment V4 proved that a direct value import of one module's internals from another module lints clean. Three independent defects each individually disable the rule:

1. **Path patterns never match.** Elements are declared as `apps/api/src/modules/*`, but ESLint runs per-package with cwd `apps/api`, so files present as `src/modules/…`. Nothing is ever classified.
2. **The config targets the wrong plugin major.** It uses the v5-era API (`boundaries/element-types`, `rules:`, string selectors, rule-level `importKind`) while the installed dependency is **v7.0.2**, which renamed the rule to `boundaries/dependencies`, renamed `rules` to `policies`, and moved to object selectors. With corrected paths the plugin emits four deprecation warnings and still fails to flag the violation (V5).
3. **Imports cannot be resolved.** The plugin bundles only `eslint-import-resolver-node`, which cannot map this codebase's NodeNext-style `.js`-suffixed relative imports (`../alpha/internal.js`) back to `.ts` sources. Unresolvable imports are never classified, so no policy can ever apply.

Additionally, the config's claim to enforce §3.8 is **false**: `platform` and `domain` element types are declared but appear in no rule whatsoever, and those patterns (`packages/platform/src/*`) could never match from `apps/api`'s lint context anyway. There is also no constraint on the kernel↔module direction (kernel importing module internals would create the exact coupling the plan forbids).

**Long-term impact.** This is the highest-leverage defect in the repository. From Phase 1 onward, every module (identity, directory, scheduling, booking, clinical…) will be written — largely by an AI agent, at high volume — under the belief that cross-module imports are mechanically impossible. They are not. Violations will accrete silently, and by Phase 4–5 the "modular monolith" can degrade into an entangled monolith whose module extraction story (§ future replaceability) is fiction. This is precisely the "false assurance" failure mode MM-PLAN-001 §3.6 identifies as the reason the previous codebase failed.

**Recommended solution.**

1. Rewrite `api.js` against the v7 API. The following shape was **proven to fire** in experiment V6:
   ```js
   settings: {
     "boundaries/elements": [
       { type: "module", pattern: "src/modules/*", capture: ["module"] },
       { type: "kernel",  pattern: "src/kernel/*" },
     ],
   },
   rules: {
     "boundaries/dependencies": ["error", {
       default: "allow",
       policies: [{
         from: { element: { types: "module" } },
         disallow: [{ to: { element: { types: "module" } }, dependency: { kind: "value" } }],
         message: "…MM-PLAN-001 §3.1…",
       }],
     }],
   }
   ```
2. Add `eslint-import-resolver-typescript` and configure `settings["import/resolver"]` so `.js`-suffixed TS imports resolve (the fixture only fired once resolution succeeded).
3. Actually enforce §3.8: add policies covering `packages/platform` (modules/domain may import adapter _interfaces_, not concrete adapter implementations once those exist) and forbid kernel→module value imports. This likely requires classifying cross-package imports (resolver + patterns anchored at the repo root via `boundaries/root-path`), or an equivalent `no-restricted-imports` scheme — decide deliberately, don't leave it aspirational.
4. **Add a meta-test.** Commit a known-violating fixture (or a small vitest that runs ESLint's Node API against an in-memory violation) asserting the rule reports an error. The guardrail itself must be under test, or this failure mode will recur on the next plugin major.

**Fix before Phase 1?** **Yes — blocking.** Phase 1 creates the first real modules; the fence must exist before the cattle.

---

### F-02 · CRITICAL — Zero commits, no remote: the Phase 0 gate has never actually run in CI

**Where:** repository root (git state); `.github/workflows/ci.yml`

**Explanation.** `git log` shows no commits on `main`; `git remote -v` is empty. Every file is untracked. The GitHub Actions workflow — the artifact the Phase 0 gate is defined against ("**Gate:** `pnpm build && pnpm test` green **in CI**") — has never executed. The audit's clean-room run (V2/V3) shows the code _would_ pass, so this is a process failure, not a code failure — but the plan's phase discipline is explicit that the gate, not the work, controls sequencing.

**Long-term impact.** Beyond the formal gate: no history means no reviewability, no bisection, no rollback, and no provenance for an AI-assisted workflow where the commit trail is the primary human oversight instrument. There is also a concrete loss risk: the only copy of this codebase is untracked files on a local Windows drive.

**Recommended solution.** Add `.claude/settings.local.json` to `.gitignore` (see F-16), make the initial commit, push to a remote, and observe the CI workflow pass. Only then declare the Phase 0 gate green. Consider branch protection on `main` (require CI pass) from day one — cheap and high-value for agent-driven development.

**Fix before Phase 1?** **Yes — blocking, and trivially quick.**

---

### F-03 · HIGH — OpenTelemetry tracing is non-functional (verified)

**Where:** `apps/api/src/kernel/otel.ts`, `apps/api/src/server.ts:1-12`

**Explanation.** Experiment V7: with an OTLP endpoint configured and six HTTP requests served, the collector received **zero trace exports** — only pino log records (which arrived via a different path: the logs exporter auto-configured itself from the `OTEL_EXPORTER_OTLP_ENDPOINT` env var, appending the correct `/v1/logs` suffix). Three compounding defects:

1. **Instrumentation starts too late.** ESM imports are hoisted: `fastify` (and through it `node:http`) is fully loaded before `startOtel(env)` executes on line 12 of `server.ts`. Patch-based instrumentation cannot retroactively instrument already-loaded modules. (The pino _logs_ signal worked only because Fastify lazily instantiates its logger after `sdk.start()` — a coincidence, not a design.)
2. **No ESM loader hook.** Under pure ESM, `@opentelemetry/auto-instrumentations-node` requires registration via `--import`/loader hooks (`import-in-the-middle`); calling `NodeSDK.start()` inside application code is insufficient regardless of ordering.
3. **Wrong exporter URL semantics.** `new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT })` uses the URL **verbatim**; unlike env-var auto-configuration it does not append `/v1/traces`. Even with working instrumentation, spans would be posted to the endpoint root and rejected.
4. (Consequential) No `service.name` resource is set — any spans that ever did export would report as `unknown_service:node`.

**Long-term impact.** The plan's observability strategy (§1) and the Phase 10 gate (outbox-lag dashboards, booking-funnel p95s, alerting) assume tracing works. Worse, Phase 1's kernel — outbox dispatch, pg-boss, exactly-once semantics — is exactly the code you debug with traces. Discovering in Phase 10 that no span was ever recorded is the expensive version of this finding.

**Recommended solution.** Move telemetry bootstrap into a dedicated `instrumentation.ts` entry loaded before the app (`node --import ./dist/instrumentation.js dist/server.js`, wired into Dockerfile `CMD` and the `dev` script), or at minimum a side-effect import as the first line of `server.ts` with the ESM loader registered. Drop the manual `url` and let env-var auto-configuration handle paths (it demonstrably works — the logs signal proved it). Set `OTEL_SERVICE_NAME=mesomed-api` or an explicit resource. Then **verify with a test** (the fake-collector harness from this audit is ~20 lines and could become a smoke test): assert at least one span arrives for a `/health` request.

**Fix before Phase 1?** **Yes.** The fix is small; retrofitting instrumentation habits after the kernel is built is not.

---

### F-04 · HIGH — No CORS layer: the browser web client cannot consume the API (verified)

**Where:** `apps/api/src/server.ts` (no `@fastify/cors` registered; not in dependencies)

**Explanation.** Experiment V8: a request carrying `Origin: http://localhost:3001` receives no `Access-Control-Allow-Origin` header. Browsers therefore block the web app from reading any tRPC response whenever web and API are served from different origins — which is the _only_ deployment shape the plan defines (web on Vercel, API on Railway/Fly) and the default local shape too. React Native is exempt from CORS, which is why the mobile hello screen works and this went unnoticed. Strictly, the Phase 0 gate line "web+mobile boot to hello screens" (consuming the healthcheck) cannot have been satisfied in a browser.

**Long-term impact.** Two risks. Near-term: all Phase 1+ web development against the API is broken out of the gate. More dangerous: the person (or agent) who hits this mid-Phase-1 will reach for the quick fix — `origin: true` (reflect any origin) — which becomes a genuine security hole the moment Phase 2 introduces Better Auth cookie sessions (`credentials: include` + reflected origin ≈ CSRF-adjacent exposure). CORS policy for a cookie-authenticated API is an _identity-architecture decision_ per MM-DEC, not a dev-convenience toggle.

**Recommended solution.** Add `@fastify/cors` now with an explicit env-driven origin allowlist (`WEB_ORIGIN` in the Zod env schema; no wildcard, no reflection), `credentials: true` decided consciously in the same change that documents the Phase 2 cookie posture (the plan already promises a "CSRF posture documented" item in Phase 8 — pull the decision earlier, it is a Phase 2 dependency). Add a header assertion to the health integration test.

**Fix before Phase 1?** **Yes.** Trivial to add; expensive as an improvised mid-phase patch.

---

### F-05 · HIGH — No composition root: the server is untestable as built, and tests verify a copy

**Where:** `apps/api/src/server.ts` (entire file), `apps/api/test/health.test.ts:11-25`

**Explanation.** `server.ts` executes everything at import time: env parse, OTel start, Sentry init, Fastify construction, route + plugin registration, signal handlers, `listen()`. There is no exported `buildServer()` function. Consequently `test/health.test.ts` **re-implements** the app: it constructs its own Fastify instance, re-registers the health route and the tRPC plugin by hand. Today the copy is 10 lines and stays in sync; the pattern is the problem. The test suite green-lights a parallel implementation, not the deployable artifact — a quieter cousin of the false-assurance theme in F-01/F-03.

This also collides directly with the plan: §3.8 requires adapters "wired in the `apps/api` **composition root** via env/config." Phase 0 was the moment to create that seam; it doesn't exist.

**Long-term impact.** Phase 1 must inject db clients, the outbox writer, pg-boss, and the config service into request context, and its gate demands integration tests against real command flows. Without an app factory, either every test keeps hand-wiring an ever-larger copy (guaranteed divergence), or Phase 1 starts with the refactor anyway — under schedule pressure, entangled with new kernel code.

**Recommended solution.** Split into: `app.ts` exporting `buildServer(env, deps): FastifyInstance` (pure construction — routes, tRPC, plugins, no listening, no telemetry); `server.ts` as a thin entry (load env, init telemetry, build, listen, shutdown). Rewrite the existing test to import `buildServer` and use `app.inject()`. The `deps` parameter (even if empty today) is the composition-root seam Phase 1's adapters and kernel services plug into.

**Fix before Phase 1?** **Yes.** It is a prerequisite for Phase 1's own definition of done.

---

### F-06 · MEDIUM — Dev-server port collision and fragile client URL defaults

**Where:** `apps/api/src/env.ts:5` (PORT default 3000) · `apps/web` (`next dev` default 3000) · `apps/web/app/providers.tsx:8` · `apps/mobile/app/_layout.tsx:8`

**Explanation.** `pnpm dev` launches both persistent dev tasks; API and Next.js both default to port 3000. Whichever binds first wins; Next silently hops to 3001 (or the API crashes). Meanwhile both clients hard-default to `http://localhost:3000` — which, if Next grabbed 3000 first, is the _web_ origin, not the API. Every dev session becomes a race. The mobile default has an additional classic pitfall: on a physical device `localhost` is the phone, so `EXPO_PUBLIC_API_URL` must be a LAN address — currently undocumented.

**Long-term impact.** Chronic DX friction and misleading "API unreachable" states that mask real regressions (the hello screen renders identically whether the API is down, CORS-blocked, or mis-addressed).

**Recommended solution.** Give the API a distinct default port (e.g. 4000) in the Zod env schema, or pin web to `next dev -p 3001`; update both client fallbacks; ship `.env.example` files (see F-18) documenting `NEXT_PUBLIC_API_URL` / `EXPO_PUBLIC_API_URL` including the physical-device case.

**Fix before Phase 1?** Yes (minutes of work, daily payoff).

---

### F-07 · MEDIUM — tRPC error formatter clobbers the canonical error code and loses HTTP semantics

**Where:** `apps/api/src/trpc/trpc.ts:6-17` · `packages/contracts/src/errors.ts`

**Explanation.** The formatter overwrites `shape.data.code` — which in tRPC's contract carries the standard TRPC error code (`UNAUTHORIZED`, `BAD_REQUEST`, `INTERNAL_SERVER_ERROR`…) — with the application `ErrorCode`. Two consequences: (a) any client tooling, retry/interceptor logic, or teammate expectation built on tRPC's documented `data.code` semantics silently reads MesoMed codes instead; (b) because nothing maps `AppError` to a `TRPCError` code, **every** `AppError` — including `UNAUTHORIZED` and `NOT_FOUND` — surfaces as HTTP 500 `INTERNAL_SERVER_ERROR`. Status-code-based infrastructure (load balancer alerting, Sentry grouping, client 401→login redirects) all degrade. There is also no test covering the formatter, and no procedure yet throws `AppError`, so the flaw is invisible.

**Long-term impact.** §3.11 makes the typed error model a kernel contract that every module builds on from Phase 1. Shipping the wrong shape now means either migrating every client switch later or living with 500-for-everything semantics.

**Recommended solution.** Map `AppError.code` → proper `TRPCError` codes (a small kernel `toTRPCError()` used by procedures or a middleware), and expose the app code under a distinct, non-colliding key (e.g. `data.appCode`) — or make the mapping table itself part of `contracts/errors`. Add a contract test: throw each `ErrorCode` from a dummy procedure and assert HTTP status + formatted body (this is exactly the §3.12 "contract test" pattern, applied to the kernel).

**Fix before Phase 1?** Yes — the error model is a Phase 1 deliverable; land it correctly the first time.

---

### F-08 · MEDIUM — Runtime Docker image ships full dev dependencies and all source

**Where:** `apps/api/Dockerfile:16-23`

**Explanation.** The runner stage does `COPY --from=installer /app .` — the _entire_ workspace: all `node_modules` including every devDependency (typescript, tsup, tsx, vitest, pino-pretty, eslint toolchain), all TS source for every package, under the hoisted (fully materialized, non-symlinked) layout. The tsup output is not self-contained — third-party deps (fastify, otel, sentry, pino) are intentionally external — so _some_ node_modules is required, but only production deps. Note ADR-0001 §4's description of a "single self-contained `dist/server.js`" is inaccurate on this point and should be corrected when amended.

Secondary issues: the base stage installs `pnpm@11` / `turbo@2` floating (drifts from the `packageManager` pin — use corepack against the lockfile-pinned version); no `HEALTHCHECK` despite a purpose-built `/health` endpoint; no `--enable-source-maps` despite shipping sourcemaps.

**Long-term impact.** Hundreds of MB of dead weight per deploy, slower cold starts and pulls, and a needlessly large CVE surface that will pollute the Phase 10 security review with devDependency noise.

**Recommended solution.** Add a prune step before the runner copy — `pnpm deploy --filter=@mesomed/api --prod /out` (or `pnpm prune --prod`) — and copy only `dist/` + production `node_modules`. Pin toolchain versions via corepack. Add `HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/health || exit 1` and `NODE_OPTIONS=--enable-source-maps`.

**Fix before Phase 1?** Deferrable to first real deployment, but recommended now while the Dockerfile is 23 lines; pair with F-09b so it can't rot.

---

### F-09 · MEDIUM — CI pipeline gaps

**Where:** `.github/workflows/ci.yml`

**Explanation & recommendations (independent sub-findings):**

- **(a) `format:check` never runs.** A Prettier config and script exist, but CI doesn't enforce them; drift accumulates until a giant reformat commit destroys blame history. Add one step. _(Fix now.)_
- **(b) The Docker image is not built in CI**, despite being _the_ deployment artifact and part of the Phase 0 gate ("API container runs locally"). Dockerfiles rot fast; `docker build` on PR (no push) keeps it honest. _(Fix by first deploy; recommended now.)_
- **(c) Silent no-op coverage:** `apps/web` and `apps/mobile` define no `test` task; `apps/mobile` defines no `build` task. Turbo silently skips absent scripts, so "Unit tests ✓ / Build ✓" is structurally green for two of three apps. Mobile never even typechecks its export path (`expo export` unexercised). Acceptable for Phase 0 scope — but be aware the green checkmark overstates coverage; add at least an `expo export` smoke build before Phase 9, and per-app test scripts as soon as each has logic. _(Defer, documented.)_
- **(d) No `permissions:` block** — the workflow runs with the default (potentially write-capable) `GITHUB_TOKEN`. Add `permissions: { contents: read }`. _(Fix now — one line.)_
- **(e)** Actions pinned by tag (`@v4`) not SHA — acceptable at this scale; consider SHA-pinning plus Dependabot for actions at Phase 10. _(Defer.)_
- **(f)** No turbo remote cache — fine now; revisit when CI minutes hurt. _(Defer.)_

**Fix before Phase 1?** (a) and (d) yes (two lines total); rest per notes.

---

### F-10 · MEDIUM — Phase 0's own UI violates the day-one i18n convention

**Where:** `apps/web/app/layout.tsx:12` (`lang="en" dir="ltr"`) · `apps/web/app/page.tsx:9,24` · `apps/mobile/app/index.tsx:8,14` (hardcoded `locales.en`, raw strings `"Checking API…"`, `"API unreachable"`)

**Explanation.** Convention §3.10 is unambiguous ("every user-facing string in catalogs **from day one**. No hardcoded strings"), and the locked stack declares **ckb the default locale** — an RTL language — yet the web document is hardcoded LTR English, both clients pin `locales.en`, and two user-facing strings bypass the catalogs entirely. The catalogs and `rtlLocales` metadata in `packages/i18n` are correct; the consumers ignore them. Neither next-intl nor use-intl (both in the locked stack) is installed — a stack deviation not recorded in ADR-0001.

**Long-term impact.** Scaffold code is precedent: Phase 1+ contributors (human or agent) copy the hello screen's idioms. Every phase that ships `locales.en.foo` and literal strings deepens the exact retrofit MM-PLAN-001 §3.10 was written to prevent — and RTL-first layouts are famously painful to retrofit onto LTR-assumed markup.

**Recommended solution.** Minimum honest fix now (cheap): move the two raw strings into all three catalogs; drive `lang`/`dir` and locale selection from `defaultLocale`/`rtlLocales` (ckb/RTL renders by default — which also smoke-tests RTL from day one); record the next-intl/use-intl deferral (or adopt now) in an ADR amendment. Full i18n routing can still land Phase 8.

**Fix before Phase 1?** The string/dir fix, yes (an hour); framework wiring may defer with ADR note.

---

### F-11 · MEDIUM — Sentry integration is init-only and will miss request-scoped errors

**Where:** `apps/api/src/kernel/sentry.ts` · `apps/api/src/server.ts`

**Explanation.** Same structural problem as F-03: `@sentry/node` v8+ (v10 here) is OTel-based and requires initialization **before** app modules are imported (`--import` entry under ESM) for its automatic http/fastify instrumentation to attach. Additionally, `Sentry.setupFastifyErrorHandler(app)` is never called, so route errors won't be captured with request context, and shutdown never calls `Sentry.close()`, so buffered events are dropped on SIGTERM — precisely when crash reports matter. As-is, Sentry captures little beyond global unhandled exceptions.

**Recommended solution.** Fold into the same `instrumentation.ts` preload entry as F-03; call `setupFastifyErrorHandler` in the app factory (F-05); flush in shutdown (F-12). Verify with a test route that throws, asserting the event hits a mocked transport.

**Fix before Phase 1?** Yes — same change-set as F-03/F-05; near-zero marginal cost.

---

### F-12 · MEDIUM — Graceful-shutdown defects

**Where:** `apps/api/src/server.ts:35-43`

**Explanation.** `shutdown()` ends in unconditional `process.exit(0)` — a failed `app.close()`/`shutdownOtel()` still reports success to the orchestrator; a rejection inside the `void shutdown(...)` wrapper becomes an unhandled rejection; a second signal re-enters shutdown concurrently; there is no timeout forcing exit if a hung connection stalls `close()`; Sentry is never flushed.

**Long-term impact.** Phase 1 adds a pg-boss worker and DB pools to this path. In-flight outbox dispatches killed by an ungraceful or falsely-successful shutdown are how "exactly-once under retry" gates (Phase 1) start flaking in CI and prod.

**Recommended solution.** Idempotent shutdown guard; try/catch with `process.exit(err ? 1 : 0)`; a hard-kill timer (e.g. 10s); `Sentry.close()` before exit. ~15 lines, best landed together with the F-05 factory refactor.

**Fix before Phase 1?** Yes — it's the skeleton Phase 1 hangs teardown on.

---

### F-13 · LOW — Health endpoint semantics will need a liveness/readiness split

**Where:** `apps/api/src/server.ts:22-28` · `apps/api/src/trpc/router.ts:4-10`

**Explanation.** A single always-200 `/health` (duplicated as REST and tRPC, with response construction repeated in three places counting the test) is fine while the API has no dependencies. From Phase 1 the API has Postgres and pg-boss: orchestrators need liveness (process up) vs readiness (deps reachable, migrations applied) distinguished, or deploys will route traffic to instances that can't serve.

**Recommendation.** In Phase 1 kernel work: keep `/health` as liveness, add `/ready` with dependency checks; factor the response builder once into the kernel. **Defer to Phase 1** (by design).

---

### F-14 · LOW — Turbo task graph encodes dependencies that don't exist

**Where:** `turbo.json`

**Explanation.** `lint`, `typecheck`, and `test` all declare `dependsOn: ["^build"]`, but internal packages intentionally have no build step (raw-TS strategy, ADR-0001 §4). The practical effect today: web/mobile lint waits on the full `@mesomed/api` tsup build (observed in V3 output) for no benefit. No `inputs` are declared, so caches are coarser than necessary. Harmless now; misleading as the graph grows — someone will assume `^build` is load-bearing and preserve it, or worse, rely on it where it isn't wired.

**Recommendation.** Drop `^build` from `lint` (and `test` unless a task genuinely consumes built artifacts); re-add per-task when a compiled package actually appears. **Defer** — batch with the next turbo.json touch.

---

### F-15 · LOW — Vestigial/inconsistent TypeScript project machinery

**Where:** root `tsconfig.json` · `tooling/typescript-config/base.json` · `apps/mobile/tsconfig.json`

**Explanation.** (a) Root `tsconfig.json` declares project references but omits `apps/mobile`, and references `apps/web` whose config sets `composite: false` — so `tsc -b` at the root would fail; nothing uses it, making it a false affordance. (b) `composite: true` + `declaration(Map)` in the shared base drive nothing (all packages run `--noEmit`) but produce stray `.tsbuildinfo` artifacts. (c) `apps/mobile` extends `expo/tsconfig.base` (necessarily, per ADR-0001 §5) and manually re-adds some strict flags but **not** `noUncheckedIndexedAccess`/`noImplicitOverride` — the one workspace with weaker strictness, unrecorded.

**Recommendation.** Either maintain the root solution file correctly or delete it; strip `composite`/`declaration` until a real `tsc -b` pipeline exists; add the two missing strict flags to mobile (they work regardless of the Expo base). **Defer** — cosmetic, but note the mobile strictness gap in the ADR.

---

### F-16 · LOW — `.claude/` local settings not gitignored

**Where:** `.gitignore` · `.claude/settings.local.json`

**Explanation.** `settings.local.json` is machine-local configuration that convention keeps out of version control. Because no commit exists yet (F-02), nothing has leaked — but the first commit would sweep it in.

**Recommendation.** Add `.claude/settings.local.json` to `.gitignore` **before the initial commit** (part of the F-02 fix). _(If the team later wants shared, checked-in agent permissions, that's `.claude/settings.json`, a deliberate separate decision.)_

---

### F-17 · LOW/MEDIUM — Hoisted node-linker invites phantom dependencies

**Where:** `.npmrc` (`node-linker=hoisted`, `strict-peer-dependencies=false`, `auto-install-peers=true`)

**Explanation.** The hoisting decision is well-justified and ADR-documented (Expo/Metro constraint). Its cost: the _entire workspace_ — including the API — now has npm-style flat `node_modules`, so any package can import dependencies it never declared. That compiles and tests green until the dependency graph is consumed strictly — e.g., the `pnpm deploy --prod` image recommended in F-08, or a future un-hoisting — at which point undeclared imports explode at runtime in production. The peer-laxity flags similarly mute early warnings of version conflicts.

**Recommendation.** Compensate with lint: enable an `import/no-extraneous-dependencies`-equivalent (or a periodic `depcheck` CI step) so undeclared imports fail fast despite hoisting. **Defer-able**, but land before the module build-out accelerates in Phases 2–4.

---

### F-18 · LOW — No `.env.example`, no README

**Where:** repo root, `apps/*`

**Explanation.** The Zod env schema is the machine truth, but nothing documents `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `NEXT_PUBLIC_API_URL`, `EXPO_PUBLIC_API_URL` for a human (or a fresh agent session) bootstrapping the repo — and there is no root README with a quickstart at all (CLAUDE.md governs agents; humans get nothing). **Recommendation:** `.env.example` per app + a short root README (prereqs, `pnpm i`, `pnpm dev`, ports, doc map). Cheap; do with F-06.

---

### F-19 / F-20 · LOW — Contracts-package observations (no action required now)

- **F-19:** `AppError` (a runtime class) lives in `packages/contracts` alongside pure schemas. Defensible — clients switch on `ErrorCode` — but only the server should _throw_ it; revisit placement when the kernel error model lands (F-07).
- **F-20:** `eventEnvelope()` types `name` as bare `string` and has no test. Fine for Phase 0; Phase 1's event registry should brand event names (template-literal `module.event.vN` type) and test the envelope — flagging now so it lands in the Phase 1 definition of done.

---

### F-21 · LOW — ADR-0001 contains two inaccuracies to amend

**Where:** `docs/adr/0001-locked-stack.md`

1. §4 describes the API artifact as a "single self-contained `dist/server.js`" — it is not self-contained; all third-party deps are externals resolved from `node_modules` (materially relevant to F-08).
2. The web app's locked-stack deviations (no Tailwind v4, no shadcn/ui, no next-intl/use-intl in Phase 0) are real, reasonable deferrals — but unrecorded, and §3.14/§3 discipline is that deviations get written down.

**Recommendation.** One small amendment ADR (or errata section) covering both, plus the mobile strictness gap (F-15c). Do alongside the pre-Phase-1 fix batch, which itself deserves an ADR.

---

## 5. Over-engineering vs Under-engineering

**Over-engineering: essentially none.** The scaffold is admirably restrained — empty placeholder packages carry honest "lands in Phase N" comments instead of speculative abstractions; no second adapters; no Redis; no premature Meilisearch. The only dead machinery is TypeScript project-reference/composite plumbing that nothing consumes (F-15).

**Under-engineering concentrates in exactly one theme: verification of the invisible.** Boundaries enforcement (F-01), tracing (F-03), CI execution (F-02), test-vs-artifact fidelity (F-05), error semantics (F-07) — every one is a mechanism whose _presence_ was delivered but whose _function_ was never demonstrated. The remedy is not more architecture; it is the meta-test habit: each guardrail ships with a proof it fires.

## 6. Scalability, Maintainability, Replaceability

The locked architecture remains the right call and Phase 0 does not compromise it: a modular monolith with transactional outbox on Postgres comfortably serves the launch scale implied by the plan (single instance, in-memory rate limiting, ~200k directory rows in the Phase 3 perf gate), with clean later exits (Redis-backed rate limit, Meilisearch adapter, module extraction) already mapped in §8 of the plan. Replaceability rests on two mechanisms — adapter interfaces and module isolation — of which the first has no code yet (fine) and the second has no working enforcement (F-01). Fix F-01 and the replaceability story is credible. One watch item: the type-level coupling of both clients to `@mesomed/api/router` (standard tRPC practice) is currently safe — `import type` plus the fail-fast fact that a value import of raw server TS would break the Next build — but consider an explicit lint ban on value imports from `@mesomed/api` in client apps as a belt-and-braces guard.

## 7. AI-Assisted Development Readiness

CLAUDE.md is a genuinely strong governance instrument: conventions verbatim, precedence rules explicit, phase discipline stated. Two structural observations for an agent-built codebase: (1) agents generate code at a volume where _prose_ conventions under-constrain and _mechanical_ gates (lint, CI, meta-tests) are the real contract — which elevates F-01/F-02 from tooling bugs to governance failures; (2) the gate-not-calendar discipline only works if gates are executed artifacts, not assertions — hence the F-02 requirement that "green in CI" mean an actual CI run. Recommended additions when convenient: a root README (F-18) so cold-started sessions bootstrap cheaply, and a `verify`-style checklist (build container, hit /health, observe a span) so "done" claims are demonstrable.

## 8. Phase 1 Readiness — Required Actions

**Blocking (Phase 1 must not start until these are closed and observed green):**

| #   | Action                                                                                                                                                | Finding     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Rewrite boundaries config (v7 API + TS resolver + §3.8 policies) **with a meta-test proving it fires**                                                | F-01        |
| 2   | Gitignore `.claude/settings.local.json`; initial commit; push; observe CI green; protect `main`                                                       | F-02, F-16  |
| 3   | Telemetry preload entry (`--import`), env-var-driven exporters, `service.name`; span smoke-test. Fold Sentry (error handler + flush) into same change | F-03, F-11  |
| 4   | `@fastify/cors` with explicit env-driven allowlist; document cookie/CORS posture ahead of Phase 2                                                     | F-04        |
| 5   | Extract `buildServer()` app factory; tests consume the factory; hardened shutdown                                                                     | F-05, F-12  |
| 6   | AppError→TRPCError mapping with contract test                                                                                                         | F-07        |
| 7   | Distinct dev ports + `.env.example` + README quickstart                                                                                               | F-06, F-18  |
| 8   | CI: add `format:check` step and `permissions: contents: read`                                                                                         | F-09a/d     |
| 9   | ADR recording this remediation batch + ADR-0001 errata                                                                                                | F-21, §3.14 |

**Strongly recommended, may overlap Phase 1 start:** Docker prod-prune + HEALTHCHECK + CI docker-build job (F-08, F-09b); i18n string/dir fix (F-10); phantom-dependency lint (F-17).

**Correctly deferred (do not build now):** readiness endpoint (F-13, Phase 1 scope), turbo graph tuning (F-14), tsconfig reference cleanup (F-15), event-name branding (F-20, Phase 1 scope), everything in MM-PLAN-001 §8.

---

## 9. What Is Sound (for balance)

- Repository layout matches MM-PLAN-001 §2 exactly; placeholder packages are honest, not speculative.
- Strict TypeScript (incl. `noUncheckedIndexedAccess`, `noImplicitOverride`) across the workspace; zero `any`/`ts-ignore`; flat ESLint configs cleanly shared from `tooling/`.
- The raw-TS internal-package strategy is pragmatic, consistently executed (`transpilePackages` / Metro config / tsup `noExternal`), and ADR-documented with real verification notes.
- Zod-validated fail-fast env; adapter no-op behavior for absent DSN/endpoints is the right dev/CI ergonomics.
- `turbo prune --docker` staging and a non-root runtime user; explicit pnpm build-script allowlist (`allowBuilds`) is a quiet supply-chain positive.
- Frozen-lockfile installs reproduce cleanly cross-platform (verified); CI has correct shape, concurrency cancellation, and Node 22 pinning consistent with `.nvmrc`/engines.
- Health contract flows through `packages/contracts` into REST, tRPC, both clients, and tests — the exact dependency direction the architecture wants to habituate.
- Trilingual catalogs (en/ar/ckb) exist from day zero with ckb correctly declared default and RTL metadata present.
- ADR-0001 is a model of recording _reasoning_ for deviations — the two errata in F-21 notwithstanding.

---

_Audit method note: no repository code was modified. All experiments (V1–V8) ran against an isolated copy in the session scratchpad; fixtures and the fake OTLP collector were confined there. Evidence summaries are in §2._
