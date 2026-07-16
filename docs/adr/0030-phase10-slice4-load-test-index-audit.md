# ADR-0030 — Phase 10 Slice 4: k6 load test @10× + index audit

## Status

Accepted. Phase 10 Slice 4 per MM-DES-003 §6, rulings D1/D2
(2026-07-16). Executed on the owner-provisioned Railway scratch
environment; **all §6 pass criteria passed at 1× and 10×**; the
environment was torn down after evidence capture. Numbering per the §3
next-free rule (§3's indicative 0027 was consumed by Slice 5 while this
slice was parked).

## Context

MM-PLAN-001 §5 Phase 10 requires load-testing booking + directory at
10× expected launch traffic plus an index audit. D1 fixed the baseline
(300 bookings/day, ~1,500 directory sessions/day, ~25 peak concurrent;
10× = 3,000/15,000/250 VUs, never beyond 10×) and ratified the §6 pass
criteria; D2 fixed the target as a temporary scratch managed
environment (nothing is deployed today, D10).

## Decision / what shipped

1. **k6 suite** (`tooling/k6/`): three-scenario mixed-traffic script
   (directory sessions, guest bookings with typed-conflict accounting,
   authenticated clinic-day polling), peak-hour arrival-rate model,
   spike mode, plus a dedicated same-slot contention script. Runner
   Dockerfile deploys next to the API so measurements exclude operator
   WAN.
2. **Deterministic load seeder**
   (`apps/api/scripts/seed/seed-load.ts`, second tsup entry →
   `dist/seed-load.js`): D1-derived ×10 volumes (2k doctors, 400
   locations, 50k patients, ~270k appointments, 50 credentialed
   secretaries), seeded-PRNG deterministic, idempotent, refuses
   NODE_ENV=production. Read models populated through the real command
   path + outbox drain; bulk history direct-inserted with the partial
   unique index respected by construction.
3. **Results** (full report: `docs/perf/phase10/load-test-report.md`):
   10× sustained+spike — p95 read 71.7 ms (<500), p95 booking 74.0 ms
   (<1000), 0 real errors in 9,972 requests (<0.1%), zero
   double-bookings over ~270k rows, outbox lag 0 s immediately post-run
   (<60 s criterion). Contention: 5 slots × 20 concurrent guests →
   exactly one winner per slot, 95 typed conflicts, 0 unexpected.
4. **Index audit: no index changes.** Every load-path query is
   index-backed and sub-4 ms at 10× volume. Two findings recorded, one
   flagged: the `search.listings` seq scan (2.6 ms at 10×) is left to
   an owner decision — pg_trgm GIN vs waiting for the deferred
   Meilisearch — with a revisit trigger (50k documents or 100 ms p95).
   The `weekly_schedules` seq-scan statistic is a seeding artifact, not
   a load-path issue (EXPLAIN-verified).

## Deviations / operational findings

- **API now listens on `::` (dual-stack)** instead of `0.0.0.0`
  (`src/server.ts`): Railway-style private networking is IPv6-only.
  Production-relevant and required for the locked Railway/Fly topology.
- The scratch API ran `NODE_ENV=test` to wire mock notification
  adapters — a load test must not call Meta/Twilio. Request-path code
  identical; recorded as a test-condition note, not a production
  deviation.
- Seed outbox drain uses direct `redeliver()` (pg-boss worker polling
  would take hours for thousands of events — ADR-0007 drain-timeout
  precedent, now structurally avoided in the seeder).
- k6: `noCookiesReset: true` is required for session-holding
  scenarios; found when clinic-day polls 401'd after the first
  iteration per VU.
- Railway: deployments snapshot their start command (`redeploy` ignores
  config changes — use `serviceInstanceDeployV2`); runtime `PORT` must
  be pinned to the domain target port.

## Environment teardown (D2: throwaway)

The Railway project (Postgres + API + k6 services, domains, tokens) was
deleted after the report was captured; the teardown is recorded in the
Slice 4 PR thread. Re-running the test is fully scripted: provision
managed PG + deploy the API image + `seed-load` + the two k6 scripts.

## Consequences

- The §6 performance gate is evidence-backed green; the launch
  checklist (Slice 8) can reference this ADR and the report.
- All §6 thresholds passed at the modeled 10× traffic level (~7.5
  req/s sustained); **the saturation point of the API was not
  established**. _(Amended 2026-07-16, owner-directed: replaced an
  inaccurate "headroom is large / 7× under budget" claim — see the
  ADR-0031 amendment of the same date.)_ The Slice 3 alert thresholds
  (outbox lag > 60 s, 5xx > 2%) stand as configured — nothing observed
  in the shakedown argues for tightening or loosening them yet (no
  alert-worthy condition was inducible at 10×).
- The load suite is reusable against any future environment by setting
  `BASE_URL`/`K6_DATA`.
