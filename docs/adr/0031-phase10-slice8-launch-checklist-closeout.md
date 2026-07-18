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

### 2026-07-16 — owner-directed: Slice 4 evidence provenance + headroom correction

Two corrections to the Slice 4 (ADR-0030) record, ruled by the owner on
2026-07-16:

1. **Evidence provenance.** The load-test figures in
   `docs/perf/phase10/load-test-report.md` are self-reported by the
   executing agent from the Railway scratch environment, which was
   deleted after the run (per D2). No independent artifacts survive —
   no k6 output logs, no deployment records — so the figures were not
   independently verified. Contributing context, recorded honestly:
   during the same session, two log watchers misidentified a 1-minute
   smoke run as the 15-minute baseline, and both misidentifications
   were caught only by human log inspection.
2. **Headroom claim removed.** The "headroom is large at 10× (worst p95
   is 7× under budget)" claim in ADR-0030 §Consequences (also stated as
   "~7× headroom" in the Slice 4 handback) is removed as inaccurate:
   the 10× run sustained only ~7.5 req/s — nowhere near saturation, so
   p95-vs-budget distance says nothing about capacity headroom. The
   accurate statement, corrected in place in ADR-0030: **all §6
   thresholds passed at the modeled 10× traffic level; the saturation
   point of the API was not established.** The claim does not appear in
   `load-test-report.md` itself.

**Phase 10 carry-forward:** if load-test evidence is needed for a
future gate, re-run with log artifacts retained (k6 summary output,
deployment records) before environment teardown.

### 2026-07-17 — owner disposition of MM-QA-004 (pre-launch audit, all 28 findings)

The owner (Hakeem) ruled on 2026-07-17 on every finding in
`docs/qa/MM-QA-004-Prelaunch-Audit.md` (audited revision `f3be3e8`).
Remediation executes per `docs/qa/MM-QA-004-Remediation-Plan.md`
(landed with this amendment). **No finding is accepted as debt except
F-21** (recorded fact, no action — institutionalized as the plan's
rule 5: migration fixes ship as new migrations, never edits).

**F-01..F-05 (High): launch blockers — fix now, pre-HG-5**, in this
order:

1. Slice 1 · F-05 — web booking error classification switches on
   `appCode` (mirrors mobile).
2. Slice 2 · F-04 (code half) — v2 id-only identity events per
   convention #3 + redaction migration over existing v1 rows; closes
   MM-QA-002 F-07. (The documentation half — the erasure runbook's
   false "verified" row and the matching ADR-0028 correction — lands
   with this amendment: a launch-facing document must not keep a false
   claim while code work proceeds.)
3. Slice 3 · F-02 — account-deletion flow (3a, code) + privacy policy
   and terms pages (3b, content; legal content is owner-approved,
   never self-certified). Hard prerequisite of checklist item 1.
4. Slice 4 · F-03 — outage detection (silence-fires alerting, external
   uptime/synthetic probe config) + the six MM-ARC-002 §10.9 incident
   runbooks.
5. Slice 5 · F-01 — password recovery implemented per MM-DEC rev02 §5
   **as written**. This ruling satisfies the locked document by
   **implementing** it, so no locked-document amendment is needed.
   The slice also adds password recovery to this launch checklist
   (its omission was the F-01 aggravator).

**F-06..F-14 (Medium): all fix-now**, as named slices: Slice 6 · F-06
branch protection (owner-confirmed before applying) + stale-posture
doc corrections; Slice 7 · F-07+F-19 authz pinning across all routers;
Slice 8 · F-08 write-isolation guardrail; Slice 9 · F-09 domain-purity
guardrail; Slice 10 · F-10 adapter-ban real import path; Slice 11 ·
F-11 statement/lock/idle timeouts; Slice 12 · F-12 clinical list
bounds; Slice 13 · F-13 ar/ckb search normalization; Slice 14 · F-14
mobile lib tests.

**F-15..F-28 (Low): fixed via bundles**: Slice 15 (doc-only: F-15 +
F-17 + F-26 + F-27 + F-28 + the stray leading-backslash QA file);
Slice 16 · F-16 cycle detection; Slice 17 · F-18 directory events pin;
Slice 18 · F-20 support-grant DB cap; Slice 19 · F-22+F-23+F-24 i18n
trio; Slice 20 · F-25 seq-scan revisit trigger. F-21: recorded, no
action.

**§4 orchestrator observation (`SENTRY_DSN`):** `SENTRY_DSN`
provisioning is added to HG-2's scope (checklist item 5). The formal
checklist-item extension — together with the external uptime/synthetic
probes — lands as the dated amendment inside the F-03 slice's ADR
(Slice 4).

_(further HG outcomes land here, dated, owner-attributed)_

## Amendment (2026-07-18) — owner override: autonomous execution of the remaining MM-QA-004 remediation

Owner (Hakeem) ruling, 2026-07-18, recorded here per the amendment
pattern; this section is the authority the autonomous run executes under.

- Autonomous execution of the entire remaining MM-QA-004 remediation is
  authorized. Remediation-plan **rule 9 (pause per PR for owner
  approval) is suspended**; every other plan rule stays binding.
- Sequence: PR #76 (red-main fix, owner-approved) → web-test masking fix
  (gate integrity — until it lands no local web green is trustworthy;
  ADR-0036) → Slice 3b → Slices 4–20 in plan order. Slice 15
  additionally takes the clinic-delay clock-pin (ADR-0036's deferred
  note) and the stray leading-backslash QA file.
- Autonomous merge contract per slice: full uncached local gate on both
  sides; PR CI green → squash-merge → merge commit verified via
  `gh run view`; web verdicts read from vitest summary lines until the
  masking fix is merged, exit codes after. A red main stops the line —
  fix-forward per the #76 precedent. One slice = one branch = one PR; new
  migrations only; shipped contract versions are never edited (the
  ADR-0032 owner ruling stands).
- Mid-flight decisions that would otherwise need an owner ruling: the
  conservative option is taken and recorded in the slice ADR as
  **"delegated ruling under owner override — ratification pending."**
  Options that edit shipped artifacts or weaken a guardrail are never
  taken autonomously.
- Remaining owner-only, prepared but never executed or self-certified:
  Slice 6 branch-protection application (exact commands prepared only),
  HG-1..HG-5, the D10 production deploy, translation/RTL native-speaker
  review, and legal sign-off of the privacy/terms content — Slice 3b's
  legal text merges as **DRAFT pending owner + counsel review before
  store submission**; merging does not make it legally reviewed.

## Amendment (2026-07-18) — MM-QA-004 Slice 4 (ADR-0037): HG-2 scope extended — heartbeat rule, synthetic probes, SENTRY_DSN

Checklist item 5 (HG-2) is extended per the F-03 remediation. It now
reads: Grafana Cloud provisioned, OTLP env set on prod API, 4 dashboards
render live data, **3** alert rules imported (incl. the ADR-0037
heartbeat-absence rule), alert email test-fired, **synthetic probes
provisioned per `docs/observability/synthetic-probes.md`, and
`SENTRY_DSN` set + test event confirmed** (`docs/observability/README.md`).

Rationale: MM-QA-004 F-03 — without the heartbeat rule and external
probes, a total API outage pages nobody; without `SENTRY_DSN`, the 5xx
alert's triage instruction dead-ends. Runbooks for the six MM-ARC-002
§10.9 scenarios land in `docs/runbooks/` in the same slice.
