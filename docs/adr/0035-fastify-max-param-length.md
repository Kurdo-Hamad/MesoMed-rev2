# ADR-0035 — red-main fix: Fastify maxParamLength 414s tRPC GET batches of ≥6 procedures

## Status

Accepted. Standalone red-main remediation per MM-PLAN-001 phase
discipline ("a red main blocks all new work — the fix for the red is the
only work permitted"; precedent MM-QA-002 F-01). Not an MM-QA-004 slice;
it interrupts Slice 3b, which resumes after this merges.

## Context

On 2026-07-18 the full local gate on a clean, CI-green main (`36039eb`)
went red: `apps/web/test/clinic-delay.test.tsx` (both tests). Diagnosis
(instrumented run): the clinic page's day navigation issues one
`booking.clinicDay` query per day-shift; the tRPC `httpBatchLink`
legitimately coalesces rapid shifts into ONE batched GET whose path is
every procedure name comma-joined (`/trpc/booking.clinicDay,…×7` = 139
chars). Fastify's default `maxParamLength` (100) rejects the request
with `414 FST_ERR_MAX_PARAM_LENGTH` before tRPC sees it; every query in
the batch errors and the page never loads the day.

Why only now: the test fixture books the first free slot of the week
containing today+7, so the click count — and therefore the batch size —
varies with the weekday. Batches of ≤5 procedures (≤89 chars) pass;
2026-07-18 is a Saturday, the first day the suite ever needed 7 clicks
(and the first weekend this suite has existed through). The failure is
date-dependent but fully deterministic — and it is a REAL API defect,
not a test defect: any production client that fires ≥6 batched GET
queries gets the same 414.

## Decision

- `apps/api/src/app.ts`: `maxParamLength: 4096` on the Fastify instance
  (~200 batched procedure names; the tRPC/Fastify integration's known
  requirement). No other server behavior changes.
- Regression test `apps/api/test/trpc-batch-param-length.test.ts`:
  injects a 7-procedure batched GET (`directory.listCategories` ×7, path
  174 chars) and asserts 200 with 7 results — proven red (414) against
  the unfixed server, green with the fix.
- `clinic-delay.test.tsx` is untouched: it was correct, and its
  weekday-varying click count is what surfaced the defect. With the
  server fixed it passes on every weekday, verified today (Saturday,
  the worst case: 7 clicks).

## Gate

Pre-fix (clean main `36039eb`, uncached, WSL, repo root): format GREEN ·
lint/typecheck 20/20 · test **RED — `@mesomed/web` clinic-delay 2
failures (the 414)**, all other tasks green · build 3/3.

**Second defect observed while documenting this baseline (out of scope
here, needs its own slice):** in two consecutive full-gate runs, web's
vitest recorded the 2 failures in its own output yet **exited 0**, so
turbo reported the test task successful and the stage exit code read 0 —
while direct single-file vitest runs of the same failing suite exit 1
correctly. The web suite's failures can therefore be masked from the
local gate and CI; the redness above is asserted from the task log, not
the exit code. Until that is fixed, gate verdicts for `@mesomed/web`
must be read from the vitest summary lines, not task status.

Post-fix (uncached, WSL, repo root): format GREEN · lint/typecheck
20/20 · test 11/11 tasks, **964 tests / 130 files, zero failed suites —
verified from every task's vitest summary lines, not exit codes** (api
583/70 with the new regression test; web 12/12 including clinic-delay
on the worst-case weekday) · build 3/3.
