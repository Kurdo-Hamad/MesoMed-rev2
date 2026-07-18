# ADR-0052 — MM-QA-004 Slice 15: documentation bundle + clinic-suite clock pin (F-15, F-17, F-26, F-27, F-28)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).

## Decisions

- **F-17**: MM-PLAN-001 §6 amendment log reconciled — the ADR filename
  index now runs through ADR-0049 (was stalled at 0011), and the
  unlogged `084214e` edit (2026-07-10 MM-DEC rev02 reconciliation of
  the locked stack table + convention #7) gets its restoring entry.
- **F-15**: the Phase 3 lineage note (merge commit `110dd53` absent
  from first-parent history; Phase 3 landed via `ba48bd9`) recorded in
  §6 where the F-02 lineage lives going forward.
- **F-26**: `apps/api/.env.example` gains the two webhook rate-limit
  keys and the three retention knobs (all `env.ts`-backed, defaults
  shown). **Delegated ruling**: the audit's fourth "Phase 10 knob",
  `OTEL_METRIC_EXPORT_INTERVAL`, is not an `env.ts` variable — it is
  read by the OpenTelemetry SDK directly; it is listed commented with
  that explanation rather than added to `env.ts` (adding an unused Zod
  field would be false documentation the other way).
- **F-27**: the two "marketplace service" comments in
  `packages/domain/directory` reworded to "directory module".
- **F-28**: ADR-0019 gains the one-sentence note closing commit
  `ff59130`'s dangling waiver claim (the notification-center deferral
  lives in ADR-0024/MM-DES-003 §10).
- **Stray file (owner list item)**: `docs/\MM-QA-002-…` does NOT exist
  at HEAD — `find` across the repo returns only the correctly-named
  `docs/MM-QA-002-Full-System-Audit.md`. Nothing to delete; recorded
  here so the owner item closes on evidence.
- **Clinic-suite clock pin (owner-directed addition; ADR-0035's
  calendar-dependence note)**: `clinic-delay.test.tsx` pins its Date to
  the NEXT Saturday 09:00 relative to the real clock (worst-case
  day-shift click count, deterministically, on every machine; always in
  the future so the live-API harness still serves the pinned week).
  Only `Date` is faked — real timers keep driving network waits.
  Proven: suite green under the Saturday pin AND under a temporary
  Monday pin (the pin controls the click count; the suite is now
  day-independent by construction).

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1171 tests / 144 files, zero failed · build 3/3 — the Slice 14
post-slice gate on the tree that squash-merged verbatim to main
`68d1fa8` (CI verified green, run 29645838058).
Post-slice: identical counts — docs + the clock pin change no test
totals; the clinic suite runs pinned to next-Saturday worst case.
