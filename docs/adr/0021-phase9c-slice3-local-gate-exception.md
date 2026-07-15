# ADR-0021: Phase 9c Slice 3 — Local-CI-Only Gate Exception (Never Relied Upon)

## Status
Superseded by events — retained as history. The exception described here was
drafted but never used: CI was restored and PR #43 merged on real
GitHub-verified green. Decision to keep this file as a record (not delete it)
made 2026-07-15.

## Context
Slice 3 (mobile + web delay/recall UI) reached code-complete on 2026-07-15.
The merge gate requires green GitHub Actions CI. CI could not run: the
repository owner's GitHub account (free tier, no payment method) had exhausted
Actions billing. Rerun of run 29398795882 failed in 2–4s per job — a billing
block, not a code failure.

A local-CI-only exception was drafted (accept a full local WSL gate as one-time
evidence) to avoid stalling. It was never relied upon. See "What actually
happened" below.

## What actually happened (authoritative)
- The billing block was resolved by **making the repository public**, which
  grants unlimited Actions minutes. Rejected alternatives: adding a payment
  method (owner chose not to), and creating a new GitHub account (ToS risk of
  duplicate accounts, and it would have orphaned all PR/run history). Owner
  scanned history for secrets before flipping visibility — only test fixtures
  found.
- With CI live again, the **local-green ⇒ CI-green premise underlying this
  exception was disproven in fact, not just in principle**: a role-creation
  race in migration `0004_clinical.sql` was invisible on a local single-Postgres
  run but failed on CI's shared-Postgres parallel path (23505 on
  `pg_authid_rolname_index`). Had the local-only exception been used, it would
  have shipped a false green. This strengthens, not weakens, the F-01 rule.
- The role race was fixed first and landed as **PR #44** → `origin/main`
  824d1c2 (CI fully green).
- PR #43 (Slice 3) was **rebased onto 824d1c2**, ran real GitHub CI green
  (all 3 checks), and was **squash-merged** → `origin/main` **2475c4c**.
- The local placeholder merge commit **3ccd6dd** was **discarded**
  (`git reset --hard origin/main`). No local-only merge survives in history.

## Original decision (drafted, NOT used)
Owner had ruled: accept a full local WSL gate run (lint, typecheck, test,
build — all green on ~/mesomed, apps/api at 63 files / 571 tests) as a
documented one-time exception. Honest limits recorded at the time: the
confirming invocation replayed Turborepo cache (`FULL TURBO`) rather than
re-executing, and did not include `format` (a separate fresh full gate with
format was green). This was local evidence only. It was superseded before any
merge relied on it.

This exception set **no precedent**. Per the F-01 audit, non-GitHub-verified
green remains a false green in all future gates.

## Deviations recorded (Slice 3)
- **React pinned to exact 19.2.3** in `apps/web` (prompt said ^19.2.7):
  structural fix for a dual-React-copy issue under the hoisted linker.
- **Web test infra built fresh** (global-setup + real API + jsdom):
  `apps/web` had no prior test infra, so the "update existing web tests"
  instruction was moot.

## Carry-forwards
- **Port-race fix** (branch `fix/embedded-pg-port-race`, commit ccb664e):
  freePort() TOCTOU race in `packages/db/src/testing/index.ts`. Code-complete,
  parked. Now tracked by **ADR-0022** (its own slice/PR per the no-bundling
  rule — must not fold into Slice 3 or Slice 4). Three known limits to carry
  into ADR-0022:
  1. Port selection is moved adjacent to `start()` by splitting initialise
     and start across two embedded-postgres instances. Relies on the library
     taking the port at construction but using it only in `start()` — internal
     behavior, not a documented contract. A library upgrade could break it
     silently.
  2. The race itself is not covered by a test. The original flake was never
     reproducible, and forcing a deterministic port collision would require
     injection seams the harness does not expose. The clean leak check proves
     the leak fix, not the race fix.
  3. Out-of-scope file touched: `apps/api/test/mock-production-guard.test.ts`
     gained a missing `afterAll` — it had leaked one embedded cluster per local
     api run since Phase 7. Same leak class; the zero-leak DoD was unachievable
     without it.
