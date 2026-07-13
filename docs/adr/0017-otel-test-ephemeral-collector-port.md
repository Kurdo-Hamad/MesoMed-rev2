# ADR-0017 — Flake fix: otel.test.ts ephemeral collector port

**Status:** Accepted
**Type:** Standalone flake-fix slice (not phase work — `main` was green at
the time this was cut; MM-PLAN-001 phase sequencing is unaffected).

## Context

CI run 29212913871 failed on `apps/api/test/otel.test.ts` (the OTel export
meta-test from ADR-0011). The mock OTLP collector bound a hardcoded port
(`COLLECTOR_PORT = 43118`) that was already held on the runner:

- `EADDRINUSE` surfaced as an uncaught `error` event on the collector's
  `http.Server`.
- `beforeAll` never resolved its `listen()` promise, so the suite hung to
  the 60s hook timeout instead of failing fast with the real cause.
- `afterAll` then threw `TypeError: Cannot read properties of undefined
(reading 'exitCode')`, because `api` (the spawned child process) is
  assigned later in `beforeAll` and was never reached — masking the
  EADDRINUSE behind an unrelated teardown crash.

The failure did not recur on later runs only because the port happened to
be free — a fixed-port collision is inherently host-state-dependent, not
something a re-run resolves. Per the binding flaky-test policy
(MM-ARC-002 §3.7, also recorded in ADR-0011's "Note on test timing"
sections), re-running until green or documenting-and-moving-on are both
rejected; the obligation is to root-cause.

## Decision

1. **Ephemeral port, not a different fixed one.** The collector now binds
   `listen(0)`; the OS assigns a free port, read back via
   `collector.address().port`, and passed to the spawned API process
   through `OTEL_EXPORTER_OTLP_ENDPOINT`. The `COLLECTOR_PORT` constant is
   removed entirely — there is no fixed collector port left to collide.
   `API_PORT` (43117) is unchanged: only one test file uses it and a
   collision there would be a distinct, much rarer failure than the
   collector's.
2. **Defensive `afterAll`.** Teardown now guards each of `api`, `collector`,
   and `tdb` individually (`if (api && api.exitCode === null)`, etc.)
   before touching them. A `beforeAll` failure — this one or any future
   one — now surfaces its own real error instead of being overwritten by a
   teardown `TypeError`.

## History note

This exact fix was implemented once already, on stale PR #19 (branch
`phase-7-communication-ai`, commit `fa99f02`), validated there at 516
tests / 54 files against a `main` several phases behind today's. That PR
was closed without merging. This ADR and its commit re-land the same
root-cause fix as a fresh, standalone slice against current `main`
(`860a59f`) rather than resurrecting the stale branch, and — unlike PR
#19's note-in-ADR-0011 approach — get their own ADR: ADR-0011 documents an
already-merged, closed phase, and amending a closed phase's ADR for a fix
landing independently much later would misrepresent when and why the
change happened.

## Validation

- 3 consecutive `pnpm exec turbo run test --concurrency=1 --force` runs
  (full monorepo suite, serialized, fully uncached), all green:
  **850 tests / 105 files** every run (`@mesomed/api`: 544 tests / 59
  files, unchanged across all three runs).
- `format:check`, `lint`, `typecheck`, `build`: clean (22/22 turbo tasks).

## Deviations & notes

None beyond the history note above — this is a single-file test-harness
fix with no schema, contract, or runtime behavior change.
