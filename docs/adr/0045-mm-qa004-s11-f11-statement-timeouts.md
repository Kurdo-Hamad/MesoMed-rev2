# ADR-0045 — MM-QA-004 Slice 11: statement/lock/idle-in-transaction timeouts (F-11)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).

## Context

MM-QA-004 F-11 (MEDIUM): no `statement_timeout` — or any lock/idle-in-
transaction bound — existed at any layer of the API's database access.
A wedged query or an abandoned transaction could hold locks
indefinitely. (The audit noted this was an undocumented hardening gap,
not a broken written commitment.)

## Decision

Two layers, both shipped here:

1. **Role-level (primary)** — migration `0011_role_statement_timeouts.sql`
   (new file; F-21 rule): `ALTER ROLE mesomed_api SET` for
   `statement_timeout = '10s'`, `lock_timeout = '5s'`,
   `idle_in_transaction_session_timeout = '30s'`. Applies at login for
   sessions authenticating as the API role; migrations and admin tooling
   authenticate as the database owner and stay uncapped.
2. **Pool-level (fallback)** — `createDb(url, { timeouts })` sends the
   same three bounds as connection startup parameters (server-enforced
   by node-postgres's `statement_timeout`/`lock_timeout`/
   `idle_in_transaction_session_timeout` startup params); the
   composition root wires `API_DB_TIMEOUTS`, so the bounds hold even
   where `DATABASE_URL` logs in as a different role. Pools built
   WITHOUT the option (migration runner, test harness admin
   connections) carry no session timeouts — a long DDL/backfill
   migration must never be killed mid-deploy. API integration tests run
   through the composition root and therefore exercise the production
   posture.

**Values — delegated ruling under owner override, ratification
pending**: 10s statement / 5s lock / 30s idle-in-transaction. Rationale:
generous multiples of the slowest legitimate API query (all list
procedures are clamped; the load-test p95s are milliseconds), far below
incident-visibility thresholds, and safe for pg-boss's short
maintenance queries which share the API pool.

## Concurrency note (found by the guardrail, fixed structurally)

`ALTER ROLE … SET` writes a cluster-wide shared catalog; the
role-creation race test (concurrent migration batches on one virgin
cluster, the ADR-0022 class) failed with `tuple concurrently updated`.
An advisory lock cannot fix it — the migrator wraps its batch in one
transaction, so a waiting migrator's snapshot predates the lock and its
catalog update still trips. The shipped guard is the 0004 philosophy:
idempotent values, first committer wins, and a loser swallows exactly
that error (anything else raises). Race test green under concurrent
batches.

## Tests

`packages/db/test/timeouts.test.ts` (3): role GUCs asserted from
`pg_roles.rolconfig`; pool-level bounds proven **live** by an actual
statement-timeout cancellation of `pg_sleep` (200ms test bound — the
enforcement path itself, not just `SHOW`); a default pool shows
`statement_timeout = 0` (migrations stay uncapped).

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1125 tests / 137 files, zero failed · build 3/3 — the Slice 10
post-slice gate on the tree that squash-merged verbatim to main
`d32381b` (CI verified green, run 29641679083).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1128 tests / 138 files, zero failed · build 3/3 (db gains the timeout
suite). An intermediate gate ran RED — the role-creation race test
caught the ALTER ROLE catalog race (see the concurrency note); fixed
structurally, then this green gate.
