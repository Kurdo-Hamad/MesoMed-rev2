# ADR-0031 — Phase 10 Slice 8: launch checklist + phase close-out

## Status

Accepted as the Phase 10 close-out (convention #14). **The phase's code
and documentation work is complete; launch itself is gated on the open
human items below.** Per the owner's binding amendment (MM-DES-003
§7/§9, 2026-07-16): **HG-5 (go/no-go) happens after this ADR merges**,
and its outcome lands here as a dated amendment (ADR-0016 pattern) —
this ADR merging does NOT mean launch is approved.

## Phase 10 — what shipped (slice ledger)

| Slice | PR  | ADR      | Delivered                                                                                                                                                                     |
| ----- | --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | #50 | — (D8)   | MM-DES-003 ruled: owner amendments + D1–D10 rulings of record                                                                                                                 |
| 2     | #51 | ADR-0025 | CI security gates: pnpm audit (high+ prod), gitleaks full-history, Dependabot, CodeQL; clean history scan (1 false positive, triaged)                                         |
| 3     | #61 | ADR-0026 | OTLP metrics pipeline, outbox/booking instrumentation, 4 dashboards + 2 alerts as code                                                                                        |
| 5     | #62 | ADR-0027 | `verify:db-role` 12-check posture script (CI-verified + negative control), backup/restore runbook                                                                             |
| 6     | #63 | ADR-0028 | Retention/erasure runbook + crypto-shred design (not built, D7-B), automated prune job                                                                                        |
| 7     | #64 | ADR-0029 | Supabase migration ruled no-op (D6: no production data); no script built                                                                                                      |
| 4     | #65 | ADR-0030 | k6 @10× — **all §6 criteria passed** (p95 read 71.7 ms, booking 74.0 ms, 0 errors/9,972 reqs, zero double-bookings, contention held); index audit: no changes, search flagged |

ADR numbering shifted per the §3 "next free at merge time" rule while
Slice 4 was parked (0027→Slice 5, 0028→Slice 6, 0029→Slice 7,
0030→Slice 4); scope never shifted with the numbers.

Deviation of record: `apps/api/src/server.ts` now listens dual-stack
(`::`) — surfaced by the Slice 4 environment, required by the locked
Railway/Fly topology (ADR-0030).

## Launch checklist — every blocker, with status (2026-07-16)

| #   | Item                                                                                                                                                                                              | Status                                                                                | Owner action                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | **HG-1 — Phase 9 device verification** (ADR-0019/0024): Maestro flows on physical devices, push round-trip, TestFlight + Play internal builds, store submission                                   | **OPEN — LAUNCH BLOCKER** (kickoff constraint)                                        | Owner executes on devices/store accounts                                            |
| 2   | Native-speaker translation review (ar/ckb)                                                                                                                                                        | OPEN — owner dispositions: blocker or accepted-for-launch                             | Owner ruling required                                                               |
| 3   | Mobile RTL visual review + RTL screenshot regeneration (ADR-0016 item 10)                                                                                                                         | OPEN — owner dispositions: blocker or accepted-for-launch                             | Owner ruling required                                                               |
| 4   | Production deploy executed (D10: nothing is live today) — managed PG, API on Railway/Fly, Vercel web, domains, per `docs/deploy/phase8-production-deployment.md` (checklist signed off, ADR-0016) | OPEN                                                                                  | Owner executes/authorizes each ☐ MANUAL step                                        |
| 5   | **HG-2** — Grafana Cloud provisioned, OTLP env set on prod API, 4 dashboards render live data, alert email test-fired (`docs/observability/README.md`)                                            | OPEN                                                                                  | Owner provisions + confirms                                                         |
| 6   | **HG-3** — backup/restore drill executed against the managed PG (`docs/runbooks/backup-restore.md`), then **re-drill vs real production** before go-live                                          | OPEN                                                                                  | Owner executes/supervises                                                           |
| 7   | `verify:db-role` run green against the production database (ADR-0027)                                                                                                                             | OPEN (pending item 4)                                                                 | One command, owner-run or supervised                                                |
| 8   | Load test — §6 criteria at 10×                                                                                                                                                                    | **DONE** (ADR-0030; scratch env per D2)                                               | Optional re-run vs prod-shaped infra at owner discretion                            |
| 9   | Supabase data migration                                                                                                                                                                           | **DISPOSITIONED — no-op** (ADR-0029, D6 ruling)                                       | None                                                                                |
| 10  | Retention prune job live in prod (deploys with the API, ADR-0028)                                                                                                                                 | Deploys with item 4                                                                   | Verify first run in logs                                                            |
| 11  | **HG-4 — old codebase archived read-only** (D9: GitHub archive after a final README pointer to this repo)                                                                                         | OPEN                                                                                  | Owner admin action; final commit hash + archive date land here as a dated amendment |
| 12  | **HG-5 — launch go/no-go**                                                                                                                                                                        | **OPEN — decided AFTER this ADR merges**; outcome recorded below as a dated amendment | Owner decision on this checklist                                                    |

Standing project gates (unchanged, not new blockers): items 2 and 3 are
long-open owner deferrals restated here for disposition, per MM-DES-003
§9.

## Consequences

- Phase 10 engineering work is closed; every remaining launch item is
  an owner-executed human gate with its runbook/procedure already in
  the repo (deploy doc, observability README, backup-restore runbook,
  verify:db-role).
- MM-PLAN-001 §5's Phase 10 line items are each either delivered or
  formally dispositioned; the deferred list (§8 / MM-DES-003 §10) is
  untouched.
- This ADR accumulates dated amendments as HG-1–HG-5 close; the HG-5
  amendment is the phase's final word.

## Amendments

_(none yet — HG outcomes land here, dated, owner-attributed)_
