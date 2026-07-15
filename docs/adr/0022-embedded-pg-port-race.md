# ADR-0022 — Flake fix: embedded test-PG port race (ADR-0021 carry-forward)

## Status

Accepted. Standalone remediation slice per the no-bundling rule — this is the
carry-forward parked in ADR-0021 (branch `fix/embedded-pg-port-race`, authored
as ccb664e, rebased onto `main` c074113 for this PR). Not phase work; `main`
was green when the branch was cut. This ADR also records, for the permanent
record, the role-race findings from the PR #44 handoff (§ "Role-race findings
of record" below) — that fix merged as 824d1c2 without its own ADR.

## Context

The Slice 3 directory/authz suite flaked locally: 60 tests skipped on a
message-less `beforeAll` failure. Root cause was a TOCTOU race in
`packages/db/src/testing/index.ts`: `startEmbedded()` probed and released its
port **before** `initdb`, leaving a seconds-wide window in which a parallel
vitest fork could bind the port first. Postgres then exits at startup,
embedded-postgres rejects with `undefined` (no error text), and the abandoned
cluster leaks its `/tmp/mesomed-pg-*` data dir — the cleanup-owning handle is
never constructed on a failed attempt.

Per the binding flaky-test policy (MM-ARC-002 §3.7), re-run-until-green and
document-and-move-on are both rejected; the obligation is to root-cause.

## Decision

Three containments in `packages/db/src/testing/index.ts`, embedded path only
(the `TEST_DATABASE_URL`/CI and Testcontainers paths are untouched):

1. **Port picked immediately before `server.start()`.** `initdb` runs on a
   throwaway instance; the real instance is constructed with a
   freshly-probed port just before `start()`, shrinking the probe→bind
   window from seconds to milliseconds.
2. **Retry with fresh state.** The initialise/start cycle retries up to 3
   attempts, each with a new port and data dir, removing the abandoned dir
   before each retry (same shape as the CREATE DATABASE collision retry on
   the CI path).
3. **Real errors.** A `start()` rejection is rethrown as a real `Error`
   naming the attempt and port, with the original rejection attached as
   `cause` — no more message-less failures.

Test-file hardening in the same commit: `directory/authz.test.ts` `afterAll`
uses optional chaining so a `beforeAll` failure is never masked by a secondary
`TypeError` on `app.close()` (the masking that hid this flake's cause), and
`mock-production-guard.test.ts` gains its missing `afterAll` (see limit 3).

Verified: `/tmp/mesomed-pg-*` emptied, full api suite green (63 files /
571 tests), zero leaked dirs after the run and after the full serialized gate.

## Known limits (carried from ADR-0021)

1. **Internal-behavior dependency.** Moving port selection adjacent to
   `start()` works by splitting initialise and start across two
   embedded-postgres instances, relying on the library taking the port at
   construction but using it only in `start()`. That is internal behavior,
   not a documented contract — a library upgrade could break it silently.
2. **The race itself is not covered by a test.** The original flake was
   never reproducible, and forcing a deterministic port collision would
   require injection seams (port chooser / server constructor) the harness
   deliberately does not expose. The clean leak check proves the leak fix,
   not the race fix.
3. **Out-of-scope file touched.** `apps/api/test/mock-production-guard.test.ts`
   gained a missing `afterAll` — it had leaked one embedded cluster per
   local api run since Phase 7. Same leak class; the zero-leak DoD was
   unachievable without it.

## Role-race findings of record (PR #44 handoff §3)

The CREATE ROLE race fix (migration `0004_clinical.sql`, 23505 on
`pg_authid_rolname_index` under CI's shared-cluster parallel migrators)
merged as PR #44 → 824d1c2. Three findings from that work are recorded here
so they survive beyond the PR thread:

1. **Advisory-lock disproof.** The prompt-preferred advisory-lock shape was
   implemented first and failed the reproduction unchanged — 7 of 8
   concurrent migrators still collided. Advisory lock keyspaces are
   **per-database**, and the racing migrators each run in their own
   database, so their locks never conflict. An advisory lock is the wrong
   tool for guarding cluster-wide objects from per-database sessions.
2. **23505 ruling reversal.** The owner had previously ruled out catching
   `unique_violation` (23505) as too broad. That ruling was reversed on
   empirical grounds: in a nested block containing **only** `CREATE ROLE`,
   either `duplicate_object` or `unique_violation` can only mean another
   migrator won, and Postgres's unique-index wait semantics guarantee the
   winner has committed by the time the loser is signalled (the loser's
   insert blocks on the winner's in-flight `pg_authid` tuple; if the winner
   aborts, the insert simply succeeds). The narrowness of the block is what
   makes the broad catch safe — the reversal does not generalize to blocks
   with more than one statement.
3. **In-place edit of an applied migration — noted precedent.** The fix
   edited already-applied migration `0004_clinical.sql` in place rather
   than adding a new migration. Safe in this specific case because the
   drizzle journal tracks migration count and timestamps, not content
   hashes, and the change only alters behavior on clusters where concurrent
   creation races (fresh test clusters). This is a precedent to cite, not a
   license: editing applied migrations remains exceptional and must be
   justified case by case.

## Consequences

- The embedded-PG port race window is milliseconds instead of seconds, with
  bounded retry and diagnosable errors; temp-dir leaks on failed starts are
  fixed.
- Limit 1 means an embedded-postgres upgrade must re-verify the
  construct-vs-start port behavior (a comment in
  `packages/db/src/testing/index.ts` marks the dependency).
- The regression test for the role race
  (`packages/db/test/role-creation-race.test.ts`, 8 concurrent migrators on
  a virgin embedded cluster, deterministic 7/8-fail pre-fix / 0/8 post-fix)
  is the pattern for future cluster-wide-object race tests.
