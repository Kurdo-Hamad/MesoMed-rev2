# Phase 10 Slice 4 — k6 load test @10× + index audit (ADR-0030)

Executed 2026-07-16 per MM-DES-003 §6 and rulings D1/D2 (MM-DES-003
§8.1). **Every §6 pass criterion passed at 1× and 10×.**

## Environment (D2: temporary scratch managed environment — torn down)

- Railway project `lavish-renewal` (US West): managed Postgres 16 +
  the real API Docker image (`apps/api/Dockerfile`, same artifact CI
  builds) + a k6 runner container — all three co-located on Railway's
  private network, so measurements exclude operator WAN latency.
- API config: `NODE_ENV=test` (wires mock notification adapters — a
  load test must not call Meta/Twilio; the request-path code is
  identical), `LOG_LEVEL=warn`→`info`, `TRUST_PROXY=true`. Dispatcher,
  pg-boss, Better Auth all real.
- Seed (deterministic, `apps/api/scripts/seed/seed-load.ts`; D1-derived
  ×10 volumes, revisable): 2,043 doctors, 400 locations, 2,000 weekly
  schedules, 50,000 patients, **269,681 historical appointments** (90
  days × ~3,000/day), 50 credentialed secretaries.
- Torn down after this report was captured (project deleted — see
  ADR-0030).

## Traffic model (D1)

Arrival rates model the peak hour (15% of daily volume); VUs capped at
250 per the ruling; the multiplier never exceeds 10×.

| Scenario                                               | 1×       | 10×     |
| ------------------------------------------------------ | -------- | ------- |
| Directory sessions (browse→detail→search→availability) | 0.0625/s | 0.625/s |
| Guest bookings (weekAvailability → guestBook)          | 0.0125/s | 0.125/s |
| Auth'd clinic-day pollers (10s interval)               | 5        | 50      |

## Results

| Run                                    | Requests | p95 read    | p95 booking | Real errors   | Bookings | Verdict |
| -------------------------------------- | -------- | ----------- | ----------- | ------------- | -------- | ------- |
| 1× baseline, 15 min                    | 656      | **66.1 ms** | **82.7 ms** | **0 (0.00%)** | 10       | PASS    |
| 10× sustained 20 min + 2 min spike @2× | 9,972    | **71.7 ms** | **74.0 ms** | **0 (0.00%)** | 188      | PASS    |

§6 criteria: p95 read < 500 ms ✓ · p95 booking < 1 s ✓ · error rate
< 0.1% ✓ (typed `SLOT_UNAVAILABLE` conflicts are correct behavior and
are tracked separately — zero occurred organically in the sustained
runs) · zero double-bookings ✓ (DB assertion below) · outbox lag
recovery ✓ (below).

Detail (10×): read avg 28.6 ms, p99 135.6 ms, max 1.25 s (single
outlier); booking avg 56.5 ms, p99 103.6 ms, max 132.6 ms. Peak actual
concurrency 106 VUs (well under the 250 cap). 34 of 7,658 directory
iterations dropped (arrival-rate scheduler at spike onset) — 0.4%,
load-generator-side, no server impact.

## Same-slot contention (§6 scenario b)

5 bursts × 20 VUs firing `guestBook` at the IDENTICAL slot: exactly
**5 wins (one per slot), 95 typed `SLOT_UNAVAILABLE` conflicts, 0
unexpected responses**. The partial unique index
(`appointments_active_slot_unique`) held under deliberate concurrency.

DB assertion over the full table (269,681 seeded + 201 test bookings):

```sql
select doctor_location_id, starts_at, count(*) from appointments
where status != 'cancelled' group by 1,2 having count(*) > 1;
-- 0 rows
```

## Outbox lag recovery

Oldest-pending age was **0 s with 0 pending rows on the first
post-run reading** (three consecutive 30 s samples: 0/0/0; dead-letter
depth 0) — the dispatcher never fell behind at 10×, so the "recovers to
< 60 s within 5 min" criterion is passed trivially. Watched via the
same SQL the ADR-0026 gauge runs (HG-2/Grafana is not provisioned yet;
the dashboards were not part of this scratch environment).

## Index audit (pg_stat_statements, window = the 10× run)

Top statements by total time — all healthy:

| Query (normalized)               | Calls | Mean    | Note                     |
| -------------------------------- | ----- | ------- | ------------------------ |
| browseDoctors read               | 874   | 1.03 ms | index-backed             |
| search.listings read model       | 292   | 3.06 ms | seq scan — see finding 2 |
| pg-boss job fetch                | 3,683 | 0.11 ms | pg-boss internal         |
| session lookup (Better Auth)     | 6,600 | 0.04 ms | index-backed             |
| clinicDay appointments read      | 6,600 | 0.02 ms | index-backed             |
| weekAvailability schedule inputs | 7,512 | 0.02 ms | index-backed             |

`EXPLAIN (ANALYZE, BUFFERS)` on the hot paths confirms index scans
(weekly_schedules lookup: 0.063 ms, bitmap index scan, 3 buffer hits).

**Findings — no index changes land in this slice:**

1. `pg_stat_user_tables` shows heavy historical seq-scan volume on
   `weekly_schedules` (98 M tuples) — a **seeding artifact**: the
   planner seq-scanned while the table was small during the 2,000
   schedule writes; the load-test window itself uses
   `weekly_schedules_doctor_location_idx` (verified by EXPLAIN and
   idx_scan counters). No action.
2. `search.listings` is the only request-path sequential scan (ILIKE
   `%…%` + tsvector OR-filter cannot use a btree). At 10× volume
   (2,073 documents) it is 2.6 ms and fully buffer-resident. **Flagged
   to the owner, not decided** (MM-DES-003 §6 judgment-call rule): a
   `pg_trgm` GIN index pair would cap growth, but it adds an extension
   dependency and write amplification for a query that is 3 ms at 10×
   launch scale — and Meilisearch is the deferred-list successor for
   search anyway (MM-PLAN-001 §8). Recommendation: revisit when
   `search_documents` exceeds ~50k rows or search p95 exceeds 100 ms.

## Operational findings recorded for ADR-0030

- Railway private networking is IPv6-only → the API now listens on
  `::` (dual-stack) instead of `0.0.0.0`.
- The runtime `PORT` on Railway must be pinned explicitly to match the
  domain target port (502s otherwise).
- k6 resets per-VU cookie jars between iterations by default
  (`noCookiesReset: true` required for session-holding scenarios).
- The seed's outbox drain uses direct `redeliver()` — pg-boss worker
  polling would take hours for thousands of seed events (ADR-0007
  precedent).
