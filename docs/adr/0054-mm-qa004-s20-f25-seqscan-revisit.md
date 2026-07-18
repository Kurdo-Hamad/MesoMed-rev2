# ADR-0054 — MM-QA-004 Slice 20: search seq-scan revisit trigger made monitorable (F-25)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).

## Context

MM-QA-004 F-25 (LOW): ADR-0030's one open index-audit item — the
`search.listings` seq scan — carried revisit triggers ("50k documents or
100 ms p95") that existed only as prose: the api-latency dashboard was
aggregate-only (tRPC procedures share one Fastify route, so the HTTP
histogram cannot see them), no row-count metric or alert existed, and
MM-ARC-002 §1.4 said 150 ms where ADR-0030 said 100 ms.

## Decision

- **`mesomed.search.listings.duration` histogram** recorded by the
  listings query itself (module-owned instrumentation — the only way to
  see one tRPC procedure), feeding a p95 panel on the api-latency
  dashboard titled with the 100 ms trigger.
- **`mesomed.search.documents` observable gauge** (DB-derived, same
  posture as the outbox gauges) + a `mesomed-search-corpus` alert rule
  at 50k with `for: 1h` — a revisit tripwire, not an outage page;
  NoData stays non-firing (gauge absence = API down, owned by the
  heartbeat rule).
- **Threshold reconciled to 100 ms** (ADR-0030's number): MM-ARC-002
  §1.4's 150 ms row amended with a dated note. Delegated ruling under
  owner override — the remediation plan instructed "pick one: ADR-0030's
  100 ms"; the stricter, later, load-test-derived number wins.
- Corpus stat panel rides the same dashboard. Provisioning of the new
  rule/panels is HG-2 owner work (ADR-0037's amendment already covers
  alert-rule import).

Metric plumbing is verified by lint/type/build and no-ops without an
OTel SDK (house posture, ADR-0026); live values are confirmed at HG-2.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1194 tests / 147 files, zero failed · build 3/3 — the Slice 19
post-slice gate on the tree that squash-merged verbatim to main
`18e0cbd` (CI verified green, run 29650691497).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1194 tests / 147 files, zero failed · build 3/3 (metrics plumbing +
docs; no new tests — the search suite exercises the timed path).

Note: an earlier post-slice gate run tripped `directory/seed.test.ts`'s
outbox-drain `waitFor` — the ADR-0007 Phase 3 drain-timeout class —
while the machine was self-contended by many parallel embedded-Postgres
gates (~3.5 h wall). The suite passed 746/747 that run; a direct suite
run (747/747), an isolated run of the test, and this quiet full gate all
pass. Load artifact, not a code defect; left as-is (a bundled timeout
bump would weaken a guardrail).
