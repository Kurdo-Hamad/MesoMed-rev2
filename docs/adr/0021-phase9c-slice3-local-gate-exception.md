# ADR-0021: Phase 9c Slice 3 — Local-CI-Only Gate Exception

## Status
Accepted (temporary exception, unwind pending)

## Context
Slice 3 (mobile + web delay/recall UI) reached code-complete on 2026-07-15.
The merge gate requires green GitHub Actions CI. CI could not run: the
repository owner's GitHub account (free tier, no payment method) exhausted
Actions billing. Rerun of run 29398795882 failed in 2-4s per job — a billing
block, not a code failure.

## Decision
Owner ruled: accept a full local WSL gate run (lint, typecheck, test, build —
all green on ~/mesomed, apps/api at 63 files / 571 tests) as a documented
one-time exception.

- `origin/main` was at d556728 (Slice 2). Slice 3 branch tip 6ca14e4 was
  merged into local main via `git merge --no-ff`, producing merge commit
  **3ccd6dd**, tagged LOCAL MERGE. This merge is a **placeholder** and will
  not survive.
- PR #43 remains open, unmerged. `origin/main` unchanged at d556728.
- No push to origin, no GitHub merge of PR #43, and no Slice 4 start until
  the unwind below completes.

Honest limits of this evidence: the confirming gate invocation replayed
Turborepo cache (`FULL TURBO`, 11/11 cached) from an earlier fresh green run
rather than re-executing, and that invocation covered lint/typecheck/test/build
without `format`. A fresh full gate including format was run separately and
was green. This is local evidence only and does not substitute for CI.

This exception does NOT set precedent. Per the F-01 audit, non-GitHub-verified
green remains a false green in all future gates.

## Unwind path (mandatory, in order)
1. Add payment method / spending limit: GitHub Settings -> Billing.
2. `gh run rerun 29398795882` (or push a fresh commit if stale).
3. Verify all 3 checks green: `gh pr checks 43`.
4. `gh pr merge 43 --squash` — GitHub performs the authoritative merge.
5. `git checkout main && git pull` — local main adopts the squash; the
   local placeholder merge commit (3ccd6dd) is discarded from main history.

Slice 4 may start only after step 5.

## Deviations recorded (Slice 3)
- **React pinned to exact 19.2.3** in `apps/web` (prompt said ^19.2.7):
  structural fix for a dual-React-copy issue under the hoisted linker.
- **Web test infra built fresh** (global-setup + real API + jsdom):
  `apps/web` had no prior test infra, so the "update existing web tests"
  instruction was moot.

## Carry-forwards
- **authz.test.ts suite-level flake**: one-off beforeAll failure skipping all
  60 tests in `apps/api/test/directory/authz.test.ts`. Root cause: freePort()
  TOCTOU race in `packages/db/src/testing/index.ts` — port probed before
  initdb, bound seconds later; parallel vitest forks collide. Evidence:
  message-less hook rejection (embedded-postgres rejects with undefined),
  leaked /tmp/mesomed-pg-* dirs timestamped inside the failing run,
  unreproducible on serialized rerun. CI path is structurally immune
  (TEST_DATABASE_URL, no ports).

  **Status**: fix is code-complete on branch `fix/embedded-pg-port-race`
  (cut from d556728, commit ccb664e), local gate green, NOT merged — blocked
  on the same billing issue. It requires its own ADR and its own PR when CI
  returns; per the no-bundling rule it must not fold into Slice 3 or Slice 4.

  Known limits of that fix, to be carried into its ADR:
  1. Port selection is moved adjacent to `start()` by splitting initialise
     and start across two embedded-postgres instances. This relies on the
     library taking the port at construction but using it only in `start()` —
     internal behavior, not a documented contract. A library upgrade could
     break it silently.
  2. The race itself is not covered by a test. The original flake was never
     reproducible, and forcing a deterministic port collision would require
     injection seams the harness does not expose. The clean leak check proves
     the leak fix, not the race fix.
  3. Out-of-scope file touched: `apps/api/test/mock-production-guard.test.ts`
     gained a missing `afterAll` — it had leaked one embedded cluster per
     local api run since Phase 7. Same leak class; the zero-leak DoD was
     unachievable without it.
