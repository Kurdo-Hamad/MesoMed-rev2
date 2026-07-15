# MM-DES-003 — Phase 10: Hardening + Launch — Slicing Proposal

|             |                                                                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**    | 2026-07-16                                                                                                                                                                                                     |
| **Status**  | **Ruled plan** (Slice 1 deliverable — no code). Owner rulings on §8 D1–D10 received 2026-07-16 and recorded in §8.1; two owner amendments folded in same-day (§4 canary-only scanner demo; §7/§9 HG-5 timing). |
| **Scope**   | Phase 10 — Hardening + Launch, per MM-PLAN-001 §5 (lines quoted verbatim in §1). Phase 9c is closed (ADR-0024); `main` = 87c2366 at drafting time.                                                             |
| **Sources** | MM-PLAN-001 §1/§5, ADR-0011 (crypto-shred scope), ADR-0016 (deploy checklist sign-off), ADR-0019/0024 (open device gate), ADR-0021 (repo made public), ADR-0022, docs/deploy/, code by file.                   |

**Kickoff constraints (owner's words, binding):** one-PR slices, each with
its own ADR (next free number: 0025); every decision point and human gate
flagged here instead of decided silently; the Phase 9 device-verification
gate is still open and owner-only, and the launch checklist ADR must list
it as a blocker; for the Supabase data migration, **ask the owner whether
any production data exists — do not assume**.

## 1. Phase 10 scope (MM-PLAN-001 §5, verbatim)

> - Load test booking + directory (k6) at 10× expected launch traffic; index audit.
> - Observability: dashboards for outbox lag, dead-letter depth, booking funnel, p95s; alerts on outbox lag + error rate.
> - Security review: dependency audit in CI (npm audit + Dependabot + CodeQL), secrets scan, least-privilege DB role verification, backup/restore drill, data-retention + erasure procedure documented (crypto-shred columns for PII where audit immutability conflicts).
> - Data migration script from old Supabase DB (patients, providers, facilities, appointments) if any production data exists at cutover.
> - Launch checklist ADR; old codebase archived read-only.

## 2. Ground truth — what already exists (verified at 87c2366)

- **Observability stack is locked, not open:** MM-PLAN-001 §1 locks
  pino + OpenTelemetry (OTLP) + Sentry with "Any OTLP backend; start
  Grafana Cloud free tier". The backend choice is therefore NOT a
  decision point; provisioning the Grafana Cloud account and alert
  delivery channel is a human gate (HG-2).
- **Metric precedent exists:** `apps/api/src/kernel/metrics.ts` (channel-mix
  counter, no-ops safely without an OTel SDK). New metrics follow it.
- **Outbox already dead-letters:** `apps/api/src/kernel/outbox.ts` marks
  rows `status='dead'` after exhausting retries and publishes to
  `domain-events.dead` (`OUTBOX_DEAD_LETTER_QUEUE`). Lag and dead-letter
  depth are DB-derivable — no schema change needed to observe them.
- **CI:** single `ci.yml` (jobs: ci, docker, e2e). No dependency audit
  step, no `.github/dependabot.yml`, no CodeQL workflow, no secrets scan.
  The repository is **public** (ADR-0021), so CodeQL and Dependabot are
  free.
- **Crypto-shred scope is annotated but not implemented:** ADR-0011 marked
  `notification_log.destination/params_json/appointment_id`,
  `push_device_tokens.token`, `send_rate_events.key`, `abuse_alerts.key`
  as crypto-shred scope with 12–24 month retention, and explicitly
  recorded "no retention job built yet — scope recorded for a future
  phase". Columns are plaintext today; no key-management mechanism
  exists.
- **Least-privilege DB role:** convention #6 + the deploy doc require a
  non-owner app role in production; the clinical RLS gate (Phase 5)
  already proved deny-all against a raw connection in tests. What Phase
  10 owes is verification of the **production** role, plus an executable
  check that outlives this phase.
- **Deploy status is ambiguous to this document:** ADR-0016 item 9
  records the production-deploy **checklist** as owner-signed-off
  (2026-07-15) but also that "no manual step was executed autonomously".
  Whether production infrastructure (managed PG, Railway/Fly API, Vercel
  web) is actually live is owner knowledge → D10. Three slices depend on
  the answer (load-test target, dashboard verification, backup drill).
- **Open human gates carried in:** Phase 9 device verification (ADR-0019,
  restated open in ADR-0024) — Maestro on device, push round-trip on
  physical devices, TestFlight/Play-internal + store submission.
  Also open by prior owner deferral: native-speaker translation review,
  mobile RTL visual review, RTL screenshot regeneration (ADR-0016 item
  10). The launch checklist (Slice 8) must disposition every one.

## 3. Proposed slice map (each = one branch → one PR → CI green → merge)

| #   | Slice                                                | ADR    | Depends on       | Human gate?                       |
| --- | ---------------------------------------------------- | ------ | ---------------- | --------------------------------- |
| 1   | This design note (no code)                           | — (D8) | —                | Owner rulings on §8               |
| 2   | Supply-chain + static scanning in CI                 | 0025   | —                | D4/D5 policy rulings              |
| 3   | Observability: metrics + dashboards-as-code + alerts | 0026   | —                | HG-2 (Grafana Cloud provisioning) |
| 4   | k6 load test @10× + index audit                      | 0027   | Slice 3; D1, D2  | D1 traffic numbers                |
| 5   | Least-privilege verification + backup/restore drill  | 0028   | D10              | HG-3 (drill on managed PG)        |
| 6   | Data-retention + erasure procedure                   | 0029   | D7 ruling        | —                                 |
| 7   | Supabase data migration (or ruled no-op)             | 0030   | D6 — ruled no-op | — (D6 ruled: no production data)  |
| 8   | Launch checklist ADR + archive old codebase          | 0031   | Slices 2–7       | HG-1, HG-4, HG-5                  |

Sequencing rationale: Slice 2 first because it is dependency-free and
protects every later PR; Slice 3 before Slice 4 so the dashboards observe
the k6 runs (the load test doubles as the alert-threshold shakedown).
Slices 5–7 are order-independent after their rulings. Slice 8 is last by
definition. ADR numbers are indicative "next free at merge time" — the
ADR-0024 numbering note is precedent that interleaved standalone slices
may shift them; scope never shifts with the number.

## 4. Slice 2 — Supply-chain + static scanning in CI (ADR-0025)

Deliverables:

- **`pnpm audit` gate** as a CI step. Recommendation (D4): fail on
  `high`+ severity in **production** dependencies
  (`pnpm audit --prod --audit-level high`); dev-dependency and
  lower-severity findings are reported, not blocking. If the tree has
  existing findings at gate-introduction time, the PR fixes or documents
  each in ADR-0025 — the gate lands green, never `|| true`.
- **Dependabot** (`.github/dependabot.yml`): weekly, npm ecosystem +
  github-actions ecosystem, grouped minor/patch updates to keep PR noise
  one-per-week. Dependabot PRs ride the normal convention-#15 flow (CI
  must pass; no auto-merge — this repo's pins are load-bearing, e.g.
  react 19.2.3 exact per ADR-0024 deviation #1).
- **CodeQL** workflow (javascript-typescript), on PR + weekly cron.
  Free on the public repo. Alert triage policy: new alerts on a PR block
  that PR; pre-existing alerts triaged in ADR-0025.
- **Secrets scan:** gitleaks — (a) CI job on every PR (diff scan), and
  (b) a one-time **full-history** scan executed during this slice, since
  the repo is now public and history is world-readable. Findings policy
  is D5 and must be pre-agreed: recommendation is **rotate, don't
  rewrite** — any leaked credential is rotated via the existing
  `docs/runbooks/secrets-rotation-*.md` runbooks and the finding recorded
  in ADR-0025; git history is not rewritten (public clones make rewrite
  ineffective anyway). Expected finding classes: none (secrets have been
  env-only by design), but the scan is the proof, not the assumption.

Testing DoD note (convention #12): this slice is CI/workflow config, not
domain code — its "tests" are the workflows themselves failing on seeded
violations, demonstrated in the PR (e.g. a scratch commit with a fake
high-severity dep / fake secret, shown failing, then removed). ADR-0025
records policies and the history-scan result.

**Owner amendment (2026-07-16), binding:** the repository is public. The
scanner-failure demo's seeded "secret" must be gitleaks' **documented
test/canary string only** — never anything resembling a real credential,
even in a scratch commit that gets removed. Same rule applies to any
seeded finding used to prove the audit gate fails correctly.

## 5. Slice 3 — Observability (ADR-0026)

Four dashboard concerns from the plan; instrumentation first, then
dashboards-as-code, then alerts.

**Instrumentation (api, following `kernel/metrics.ts` precedent):**

- **Outbox lag:** an observable gauge polled from the DB —
  `max(now() - occurred_at)` over `domain_events` rows with
  `status='pending'` (plus pending count). DB-derived on purpose: a
  push-style metric from the dispatcher goes silent exactly when the
  dispatcher dies; the poll keeps reporting. Poller runs in-process on a
  timer (no new infra).
- **Dead-letter depth:** same poller, `count(*) where status='dead'`.
- **Booking funnel:** counters incremented in the booking commands
  (`guestBook`/`book`, and `transitionAppointment` by action —
  confirm/checkIn/start/complete/noShow/cancel/delay/recall). Metrics,
  **not** new event contracts: events are integration contracts
  (convention #3) and we don't mint permanent contracts for a dashboard
  (the MM-DES-002 §5 "no recall event" precedent). One counter
  `mesomed.booking.transitions{action}` + one `mesomed.booking.created{kind}`.
- **p95s:** HTTP/tRPC server latency histograms via the standard OTel
  Node auto-instrumentation already bootstrapped in `kernel/otel.ts` —
  verify spans/metrics actually export under OTLP; add the
  fastify/http instrumentation only if missing.

**Dashboards + alerts as code:** Grafana dashboard JSON + alert rules
committed under `docs/observability/` (new), provisionable into Grafana
Cloud. Alerts per the plan: (a) outbox lag, recommended threshold
`> 60s for 5m`; (b) API error rate, recommended `5xx > 2% of requests
for 5m`. Thresholds are starting values recorded in ADR-0026 and
expected to be tuned during the Slice 4 load test; alert delivery
channel (email/Telegram/etc.) is owner infrastructure → HG-2.

**Human gate (HG-2):** owner provisions Grafana Cloud (free tier per the
locked stack), sets `OTEL_EXPORTER_OTLP_ENDPOINT` + credentials on the
deployed API, connects the alert channel, and confirms live data renders
on all four dashboards. Claude Code verifies everything verifiable
locally (an OTLP collector in tests is prior art — ADR-0017) and stops at
"ready for human gate".

## 6. Slice 4 — k6 load test @10× + index audit (ADR-0027)

**Was blocked on D1 (traffic baseline) and D2 (target environment) —
both ruled 2026-07-16, see §8.1.**

- **Scenarios (k6, scripts in `tooling/k6/`):** (a) directory browse +
  detail + search (read-heavy, anonymous); (b) guest booking flow
  (slot query → `guestBook`) including contention on the same slot —
  the partial-unique-index invariant under concurrency; (c) auth'd
  clinic-day polling (the queue screens). Mixed per the D1 ratios, run
  at 1× (baseline) and 10× for a sustained window (recommend ≥ 15 min)
  plus a shorter spike.
- **Pass criteria (proposed, ratified in D1):** p95 read < 500 ms, p95
  booking command < 1s, error rate < 0.1%, zero double-bookings (asserted
  from the DB after the run), outbox lag recovers to < 60s within 5 min
  of load end (watched on the Slice 3 dashboards).
- **Index audit:** `pg_stat_statements` enabled on the target;
  top-statements review + `EXPLAIN (ANALYZE, BUFFERS)` of the hot
  queries surfaced by the load test; report in `docs/perf/phase10/`.
  Any index changes land as a normal Drizzle migration **in this PR if
  small and audit-driven**; anything judgment-call-sized (e.g. dropping
  an existing index) is flagged to the owner, not decided silently.
- **Seed data:** the load target is seeded to launch-representative
  volume ×10 headroom (D1 supplies the numbers) with a deterministic
  seed script — measuring an empty database proves nothing about index
  health.

## 7. Slices 5–8

**Slice 5 — least-privilege verification + backup/restore drill
(ADR-0028).**

- A `pnpm --filter @mesomed/api verify:db-role` script (also run as an
  integration test against a non-owner role in CI) asserting: app role is
  not superuser/owner, cannot DDL, cannot UPDATE/DELETE
  `clinical_access_log`, cannot SELECT RLS-protected clinical tables over
  a raw connection (extends the Phase 5 gate proof into a permanent,
  runnable check usable against production read-only).
- Backup/restore drill: a runbook (`docs/runbooks/backup-restore.md`)
  with provider-specific steps + verification queries (row counts,
  latest `domain_events`/`appointments` timestamps, a clinical-audit
  spot-check), executed once for real → **HG-3**: the drill touches
  production/managed infrastructure and restores into a scratch
  instance; owner executes or supervises. If production PG does not
  exist yet (D10), the drill runs against the staging/managed instance
  that will become production, and the launch checklist carries a
  re-drill item.

**Slice 6 — data-retention + erasure procedure (ADR-0029).** The plan
says "documented". Three levels — D7 picks one:

- **(A) Document only:** `docs/runbooks/data-retention-erasure.md` — per
  table: retention window, erasure action on request (DELETE / NULL /
  crypto-shred), legal basis; the crypto-shred design (per-subject key
  table; delete key ⇒ ciphertext unrecoverable) specified but not built.
- **(B) A + retention prune job (recommended):** additionally implement
  the pg-boss cron pruning `send_rate_events` (days-old, per its own
  schema comment) and the 12–24-month `notification_log` window —
  closing the ADR-0011 "no retention job built yet" carry-over. Small,
  testable, module-owned deletes of operational data; no new mechanism.
- **(C) B + implement crypto-shred columns now:** encrypt the annotated
  PII columns with per-subject keys before launch (retrofitting after
  real data exists is strictly harder — pre-launch is the cheapest
  moment). Cost: a key-management mechanism (new kernel infra), write-
  path changes in communication/abuse code, and a migration — a real
  architecture change that must not ride in silently, hence its own
  explicit ruling. Not recommended for this phase unless the owner has a
  legal/compliance driver: launch data volume is ~zero, erasure demand
  at launch is ~zero, and (A)'s documented design keeps it buildable
  on demand.

**Slice 7 — Supabase data migration (ADR-0030). Was blocked on D6 —
ruled 2026-07-16 (§8.1): no production data exists; the slice collapses
to the short-ADR path below.** If production data
exists: a one-shot, idempotent, resumable import script
(old Supabase schema → patients/providers/facilities/appointments via
the modules' own write paths or reviewed direct inserts under the
identity-continuity rules of convention #7 — normalized-phone profile
keying), dry-run mode, row-count + spot-check verification, executed at
cutover (human-supervised). If no production data exists: the slice
collapses to a short ADR-0030 recording that ruling and the deliberate
absence of a migration script (dead tooling is a liability, and the
plan's own wording is conditional: "if any production data exists at
cutover").

**Slice 8 — launch checklist ADR + archive old codebase (ADR-0031, phase
close-out).** The checklist ADR enumerates every launch blocker with
status, explicitly including:

1. **Phase 9 device-verification human gate — OPEN, owner-only**
   (ADR-0019/ADR-0024): Maestro flows on device, push round-trip on
   physical devices, TestFlight + Play internal builds, store
   submission. **Listed as a launch blocker per the kickoff constraint.**
2. Native-speaker translation review (open owner deferral) — owner
   dispositions: blocker or accepted-for-launch.
3. Mobile RTL visual review + RTL screenshot regeneration (deferred,
   ADR-0016 item 10) — same disposition call.
4. Production deploy checklist items actually executed (per D10 state).
5. Alerts live + backup drill done + role verification run against prod.
6. Go/no-go — **HG-5, owner-only; never self-certified.**

**Owner amendment (2026-07-16), binding:** HG-5 (go/no-go) happens
**after** ADR-0031 merges. The go/no-go outcome is recorded as a dated
amendment written into ADR-0031 itself — the same pattern as the
ADR-0016 sign-off amendment. Slice 8's PR therefore merges with HG-5
listed as open; the phase is not fully closed until that amendment lands.

Archiving the old codebase read-only is a GitHub admin action on the old
repository (archive flag) — owner-executed (**HG-4**); the ADR records
the final commit hash and archive date. Per convention #14 this ADR
doubles as the Phase 10 close-out.

## 8. Decisions — all open; owner rulings requested

| #   | Decision                                               | Question + recommendation                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Traffic baseline for "10×"                             | Owner supplies expected launch traffic (bookings/day, directory sessions/day, peak-hour concurrency, seeded entity counts). No defensible default exists in any repo doc — **cannot be assumed**. Slice 4 pass criteria (§6) ratified here too.                             |
| D2  | Load-test target environment                           | (a) production infra pre-launch (most honest, needs owner OK + quota awareness), (b) a scratch clone of the managed PG + API container (recommended if prod is live with real data), (c) local-only (rejected — proves nothing about prod indexes/latency). Depends on D10. |
| D3  | Alert thresholds + channel                             | Recommended starting thresholds: outbox lag > 60s for 5m; 5xx > 2% for 5m — tuned during Slice 4. Owner picks the alert delivery channel (HG-2).                                                                                                                            |
| D4  | Dependency-audit gate policy                           | Recommended: fail CI on high+ severity in prod deps; report-only below that. Alternative: fail on all severities (noisy, invites `                                                                                                                                          |     | true` rot). |
| D5  | Secrets-scan findings policy                           | Recommended: rotate via existing runbooks + record in ADR-0025; never rewrite public history. Pre-agreeing avoids an in-flight judgment call if the history scan finds something.                                                                                           |
| D6  | **Does production data exist in the old Supabase DB?** | **Owner answer required before Slice 7 is planned further — explicitly not assumed** (kickoff constraint). If yes: owner also supplies read access + a schema dump for mapping.                                                                                             |
| D7  | Retention/erasure depth                                | (A) document-only / **(B) document + retention prune job — recommended** / (C) implement crypto-shred columns pre-launch (only with a compliance driver; it is new kernel infrastructure).                                                                                  |
| D8  | ADR granularity                                        | Kickoff says one ADR per slice (0025–0031 as mapped in §3); this design note itself carries none (MM-DES-002 precedent). Confirm, incl. that ADR-0031 doubles as the convention-#14 phase close-out.                                                                        |
| D9  | Old-codebase archive mechanics                         | Recommended: GitHub "archive repository" (read-only, preserved, no history rewrite) after a final README pointer to this repo. Owner executes (HG-4).                                                                                                                       |
| D10 | Production deploy actual state                         | ADR-0016 records the checklist as signed off but no step executed autonomously. **Owner states what is live today** (managed PG? API on Railway/Fly? Vercel web? domains?). Gates D2, HG-2 verification target, and HG-3 drill target.                                      |

### 8.1 Owner rulings (2026-07-16) — all ten ruled; this section is the record

- **D1 — Traffic baseline (owner estimates, revisable):** 300 bookings/day,
  ~1,500 directory sessions/day, ~25 peak concurrent users. Test multiplier
  stays 10× per the plan → the 10× run targets 3,000 bookings/day,
  ~15,000 sessions/day, ~250 concurrent virtual users. **Do not multiply
  beyond 10×.** §6 pass criteria ratified as proposed.
- **D2 — Load-test target:** a temporary **scratch managed environment**
  (managed PG + API container), seeded per §6, torn down after the run.
  Nothing is deployed today (D10), so the production variants (a)/(b) do
  not apply.
- **D3 — Alert channel:** email to `hakeem.pijdary@gmail.com`. Thresholds:
  recommendations accepted (outbox lag > 60s for 5m; 5xx > 2% for 5m),
  tuned during Slice 4.
- **D4 — Dependency-audit gate policy:** recommendation accepted — fail CI
  on high+ severity in prod deps; report-only below that.
- **D5 — Secrets-scan findings policy:** recommendation accepted — rotate
  via existing runbooks + record in ADR-0025; never rewrite public history.
- **D6 — Old Supabase DB:** **no production data** — this is the first
  version; all data in it is test data. Slice 7 collapses to a short
  ADR-0030 recording this ruling; **no migration script is built.**
- **D7 — Retention/erasure depth:** **option B** — document + retention
  prune job (recommended option).
- **D8 — ADR granularity:** confirmed — one ADR per slice (0025–0031 as
  mapped in §3); this design note carries none; ADR-0031 doubles as the
  convention-#14 phase close-out.
- **D9 — Old-codebase archive mechanics:** recommendation accepted —
  GitHub "archive repository" after a final README pointer; owner
  executes (HG-4).
- **D10 — Production deploy actual state:** **nothing is deployed or live
  online today; everything runs locally.** Dashboards (HG-2) and the
  backup drill (HG-3) target the managed environment that will become
  production; the launch checklist carries re-verification items against
  real production.

## 9. Human-gate register (never self-certified)

| Gate     | What                                                                                                                                          | Owner action                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **HG-1** | Phase 9 device verification (open, carried in — ADR-0019/0024). **Launch blocker.**                                                           | Physical-device runs, store builds + submission |
| **HG-2** | Grafana Cloud provisioning, OTLP env on deployed API, alert channel, live-data check                                                          | Provision + confirm dashboards render live data |
| **HG-3** | Backup/restore drill against managed PG                                                                                                       | Execute/supervise drill into a scratch instance |
| **HG-4** | Archive old codebase read-only                                                                                                                | GitHub admin action on the old repository       |
| **HG-5** | Launch go/no-go — **after ADR-0031 merges**; outcome recorded as a dated amendment in ADR-0031 (ADR-0016 pattern; owner amendment 2026-07-16) | Final owner decision on the Slice 8 checklist   |

Standing project gates unchanged: native-speaker translation review and
mobile RTL review remain open owner deferrals, dispositioned (not
resolved) in Slice 8.

## 10. Explicitly out of scope (deferred list, MM-PLAN-001 §8)

Meilisearch, Redis, live payment gateways, analytics platform,
multi-region, REST/OpenAPI, microservice extraction, passkeys UI, second
AI provider, the notification system + patient-request workflows
(MM-DES-002 §12 backlog), and the MM-PLAN-001 §6 ADR-index staleness
cleanup (owner-owned docs work, MM-QA-003 F-06). None ride along in any
Phase 10 slice.
