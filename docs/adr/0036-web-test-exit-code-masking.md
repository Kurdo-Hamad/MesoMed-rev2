# ADR-0036 — gate-integrity fix: web test failures masked by embedded-postgres exit hook

## Status

Accepted. Standalone guardrail-integrity slice, executed first under the
2026-07-18 owner override (recorded as a dated amendment in ADR-0031):
until this lands, no local web-suite green is trustworthy, so it precedes
Slice 3b and everything after it.

## Context

While documenting ADR-0035's baseline, `@mesomed/web`'s vitest recorded 2
failing tests yet exited 0, so turbo reported the test task successful —
a test-gate integrity defect: web failures could be silently masked from
the local gate.

Root cause (traced with `--trace-exit` and an `async_hooks` init-stack
trap):

1. `embedded-postgres` registers an `async-exit-hook` handler **at module
   scope on import** (to stop forgotten clusters at process exit).
2. `async-exit-hook` hooks node's `beforeExit` event with a **hardcoded
   exit code 0** (`add.hookEvent("beforeExit", 0)`).
3. On test failures vitest sets `process.exitCode = 1` and lets the event
   loop drain. Node fires `beforeExit`; async-exit-hook runs the postgres
   shutdown, then calls `process.exit(0)` — clobbering the failure code.

The masking therefore hits exactly when embedded-postgres is imported
into the **main** vitest process — which is precisely the web clinic
harness: `apps/web/test/global-setup.ts` builds the embedded-PG + API
harness in vitest's node-side global setup. It is fully deterministic
there (reproduced with a deliberately failing test: full-suite and
single-file runs both exit 0).

Why nothing else is affected:

- **apps/api and other packages**: test files create the embedded server
  inside vitest worker forks; worker exit codes don't carry results, and
  the main vitest process never imports embedded-postgres.
- **CI**: `TEST_DATABASE_URL` is set, so provisioning takes the
  pg-service path and embedded-postgres is never imported. CI was never
  masked — the masking is a local-gate (WSL/embedded) defect.
- ADR-0035 recorded one direct single-file run that exited 1: explicit
  `process.exit()` paths in vitest (force-exit timer, unhandled
  rejection) bypass `beforeExit` entirely, so runs that die that way keep
  their code. Natural-drain runs — the normal case — get clobbered.

## Decision

- `packages/db/src/testing/index.ts`: the embedded path imports the
  library through a guarded `importEmbeddedPostgres()` that snapshots
  `process.listeners("beforeExit")` before the import and removes the
  listener the import adds. Rationale: the hook exists only to stop
  clusters a caller forgot to close, and every `TestDatabase` handle here
  is closed explicitly by its owner's teardown. The library's
  SIGINT/SIGTERM hooks (re-exit with 128+n — correct behavior) and its
  synchronous `exit`-event hook (non-re-exiting) are left in place.
- Regression test `packages/db/test/exit-code-masking.test.ts`: the
  guarded import must load the module while leaving `beforeExit` exactly
  as it found it.
- No library edit, no version pin change — the fix is contained in the
  module that owns the dependency choice (`@mesomed/db`'s test harness),
  per the adapter/ownership conventions.

### TDD proof

- **Red (local)**: with a deliberately failing web test on the unfixed
  tree, `vitest run` printed `Test Files 1 failed` yet exited 0 (full
  suite and single file), and `turbo run test` reported the task
  successful.
- **Green (local)**: with the fix, the same deliberately failing test
  makes `turbo run test --filter=@mesomed/web` exit non-zero; removing
  the deliberate failure returns the suite to green with correct exit
  codes. Recorded in the slice PR.
- **CI**: a temporary commit carrying the deliberately failing web test
  was pushed to the slice branch and produced a red CI run; its revert
  returned CI to green. Run ids recorded in the slice PR. (CI's pg-service
  path never had the masker; the red run demonstrates the criterion
  "a deliberately failing web test must fail turbo and CI" end to end.)

## Calendar-dependence note (deferred)

The failing tests that surfaced this defect (`clinic-delay.test.tsx`,
ADR-0035) are date-dependent: the fixture books the first free slot of
the week containing today+7, so the day-shift click count — and the tRPC
batch size — varies with the weekday the suite runs on. The suite should
pin its clock (freeze the reference date) so every run exercises the
worst-case path deterministically. Per the owner's 2026-07-18 direction
this clock-pin lands in the Slice 15 bundle, not here.

## Gate

Pre-slice (main `cdf2d4a`, uncached, WSL, repo root): format GREEN ·
lint/typecheck 20/20 · test 11/11 tasks, 964 tests / 130 files, zero
failed — verified from every task's vitest summary lines · build 3/3.
Post-slice (uncached, WSL, repo root): format GREEN · lint/typecheck
20/20 · test 11/11 tasks, 965 tests / 131 files, zero failed — verified
from every task's vitest summary lines (db 14/4 with the new regression
test) · build 3/3.
