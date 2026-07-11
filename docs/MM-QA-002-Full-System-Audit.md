# MM-QA-002 — Full-System Audit: Phases 0–6b + ADR-0010 Clinical Extension

|                      |                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**             | 2026-07-11                                                                                                                                                                                                                       |
| **Audited revision** | `main` @ `8e8afe24809cea7e454f3b0a0c0216016165ab0f` (= `origin/main`, clean tree)                                                                                                                                                |
| **Working copy**     | WSL clone `~/mesomed` (authoritative per CLAUDE.md Development environment)                                                                                                                                                      |
| **Scope**            | Everything merged to `main`: Phases 0–6b per MM-PLAN-001, ADR-0010 clinical extension, R8 post-merge verification. Phase 7 not built — its absence is out of scope by instruction.                                               |
| **Method**           | Empirical per the constitution: every claim below carries HOW it was verified (command + result, test executed, or file:line inspected). "Read the code and it looks right" is not used as verification for any guardrail claim. |

**Environment compliance note.** The audit session was invoked from the Windows
checkout (`C:\Users\Lenovo\Documents\MesoMed.rev2`), which is on a different
branch with uncommitted changes. Per the binding Development-environment rule
this was surfaced immediately; **every command, test run, grep, probe and this
report's write executed inside WSL against `~/mesomed`**. The Windows checkout
was neither built, tested, committed, nor used as evidence.

## Severity scale (MM-QA-001 precedent)

- **Critical** — an architecture invariant or phase gate is silently unmet.
- **High** — verified-broken core capability, or debt that corrupts subsequent phases.
- **Medium** — real gap; contained today, costs grow if carried into Phase 7+.
- **Low** — hygiene/documentation debt; cheap now, noise later.

---

## 1. Baseline runs (evidence appendix)

All executed from `~/mesomed` in WSL (`corepack pnpm`, node v24.16.0), serialized.

| #   | Command                                                                | Result                                                              | Evidence                                                  |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| B-1 | `pnpm exec turbo run lint typecheck`                                   | **GREEN** — 20/20 tasks successful, exit 0                          | `~/mm-qa-scratch/baseline.log` line 56 (`LT_EXIT=0`)      |
| B-2 | `pnpm exec turbo run test --concurrency=1`                             | **GREEN** — 10/10 tasks, **700 tests / 80 files, 0 failed**, exit 0 | log line 5029 (`TEST_EXIT=0`); per-package counts below   |
| B-3 | `pnpm exec turbo run build`                                            | **GREEN** — 2/2 tasks, exit 0                                       | log line 5080 (`BUILD_EXIT=0`)                            |
| B-4 | `pnpm format:check` (not requested in the brief; run to diagnose F-01) | **RED** — 9 files fail prettier, exit 1                             | reproduced locally; identical file list to CI failure log |

Per-package test counts (B-2): eslint-config 8/1 · contracts 47/6 · mobile 2/1 ·
config 17/3 · i18n 3/1 · platform 11/3 · db 12/2 · domain 157/20 · api 443/43 =
**700 tests / 80 files**.

**Baseline drift vs the stated 696/79:** +4 tests / +1 file, exactly equal to
`apps/api/test/clinical/audit-trigger-regression.test.ts` (4 tests), added
post-merge by commit `ee648d4` (the R8 verification). Drift fully accounted
for; not a defect (see F-13 for the documentation follow-up).

---

## 2. Findings

Ordered by severity. Each finding: fact → evidence → suggested owner-phase.
No fixes were applied in this session.

### F-01 · CRITICAL · `main` CI has been red since the Phase 6 merge; Phases 6b and the clinical extension were built and merged on a red gate

**Fact.** The GitHub CI runs for the last five pushes to `main` all **failed**:
Phase 6 merge (`b7987e6`, 2026-07-11 11:53), Phase 6b merge (`8207cb2`),
clinical-ext merge (`98d991d`), R8 commit (`ee648d4`), and pre-push-hook commit
(`8e8afe2`). The failing step is `Format check` (`pnpm format:check`): prettier
rejects 9 files (`apps/api/src/modules/billing/webhook.ts`,
`apps/api/src/modules/clinical/commands/prescriptions.ts`,
`apps/api/test/clinical/history.test.ts`,
`apps/api/test/clinical/prescriptions.test.ts`,
`packages/db/migrations/meta/_journal.json`,
`packages/db/migrations/meta/0006_snapshot.json`,
`packages/db/migrations/meta/0007_snapshot.json`,
`packages/domain/clinical/prescription-status.ts`, `README.md`). The last green
`main` run is the Phase 5 merge (2026-07-11 06:04). Convention #12 ("CI green
before next slice starts") and the phase-gate rule ("never start phase N+1 on a
red gate") were therefore violated for Phase 6b and the clinical extension —
the merge messages say "gate verified green", which was true of the local
lint/typecheck/test/build runs but not of CI. This is precisely the
Critical definition: a phase gate silently unmet.

**Verified by:** `gh run list` (5 × `completed failure` on `main`, 1 × success
at Phase 5 merge); `gh run view 29162052536 --log-failed` (Format check step,
exit 1, 9 files); **reproduced locally** in the clean WSL clone:
`corepack pnpm format:check` → exit 1, identical 9-file list (baseline B-4).

**Owner:** pre-Phase-7 cleanup slice, first item. Also update the gate runbook
so the local gate includes `format:check` (CI runs it; the local gate evidently
did not).

### F-02 · HIGH · Convention #15 (branch → PR → merge; branch protection) is both violated and unenforceable as documented

**Fact.** PRs exist only for Phases 1–4 (`gh pr list --state all` returns
exactly #1–#4). Phase 5 (`668c400`), Phase 6 (`b7987e6`), Phase 6b (`8207cb2`)
and the clinical extension (`98d991d`) are local merges pushed directly to
`main`; `ee648d4` and `8e8afe2` are direct non-merge commits to `main`. The
CLAUDE.md claim "Branch protection on `main` enforces this" is inert: the API
returns HTTP 403 "Upgrade to GitHub Pro or make this repository public to
enable this feature" — branch protection **cannot be enabled** on this
private-repo/free-plan combination. The compensating control added in
`8e8afe2` (versioned `.githooks/pre-push`) blocks direct pushes only in clones
that have run `git config core.hooksPath .githooks`; it is client-side and
opt-in.

**Verified by:** `git log --first-parent main` (merge/direct-commit shapes);
`gh pr list --repo Kurdo-Hamad/MesoMed-rev2 --state all` (4 PRs total);
`gh api repos/.../branches/main/protection` → 403 with the quoted message;
`git show --stat 8e8afe2` (adds `.githooks/pre-push`, 8 lines);
`git config core.hooksPath` → `.githooks` (local config, this clone).

**Owner:** pre-Phase-7 cleanup. Either restore the PR workflow and document the
protection-plan limitation honestly in CLAUDE.md (replacing the false
"enforces" claim with the hook + discipline), or change the plan/visibility so
protection can actually be enabled.

### F-03 · HIGH · CI has no dependency scan and no secret scan

**Fact.** `.github/workflows/ci.yml` (73 lines, the only workflow) runs:
format check, lint, typecheck, `pnpm test`, build, and a Docker image build.
There is **no dependency/vulnerability scan** (no `pnpm audit`, no Dependabot
config in-tree) and **no secret scanning step** (no gitleaks/trufflehog or
equivalent). Area H's expected list is otherwise satisfied — unit, integration
and contract tests all execute under `pnpm test` (verified: the vitest suites
include integration tests against real Postgres via the `TEST_DATABASE_URL`
service container, and the contract suites in `packages/contracts/test`), and
the boundaries meta-test runs because `tooling/*` is a workspace package with a
`test` script (8 tests, confirmed in B-2 output). An audit-time pattern scan of
the working tree found no committed secrets (`grep -rE` for AWS/GitHub/Slack
key shapes and private-key headers → zero hits), but nothing prevents the next
one.

**Verified by:** full read of `.github/workflows/ci.yml`; `gh run list`
(workflow executes on push and pull_request — "correct shape, never executed"
does **not** apply here, the listed steps genuinely run); secret-pattern grep
over `apps packages tooling docs` → no matches; B-2 log shows
`@mesomed/eslint-config:test` executing.

**Owner:** pre-Phase-7 cleanup (CI additions are small and phase-independent).

### F-04 · MEDIUM · Procedure-pinning authz meta-tests cover only 28 of 90 procedures (clinical + booking); the other five routers' denial matrices are hand-maintained

**Fact.** The system has **90 tRPC procedures** today: billing 25, booking 11,
clinical 17, directory 25, identity 4, scheduling 7, search 1. The audit brief's
"MATRIX test claims 17 procedures" is the **clinical** matrix, and 17 = the
actual clinical procedure count — its meta-test
(`clinical/authz.test.ts:177-182`) compares `router._def.procedures` against
the matrix, so a new clinical procedure cannot ship uncovered. Booking has the
same pinning meta-test. The other five routers have per-command denial tests
(billing `authz.test.ts` + `revenue-authz.test.ts`, directory
`authz.test.ts`, identity `authz.test.ts`, scheduling layer-b denials in
`schedule.test.ts:217-263`) but **no meta-test pinning the procedure list** —
a new billing/directory/identity/scheduling/search procedure can ship with no
denial coverage and nothing fails. That is the inert-guardrail class (R9) at
62/90 of the authz surface. In-handler ownership (layer b) checks were
verified present in the full-read areas (clinical:
`requireOwnedPrescription`/`requireEncounterActor`,
`commands/prescriptions.ts:58-68`; `requireTreatingDoctor`,
`queries/clinical-history.ts:164`) and by passing layer-b denial tests in
scheduling and billing; the remaining routers were sampled, not exhaustively
read.

**Verified by:** procedure count via
`grep -cE '^\s+[A-Za-z]+: (publicProcedure|roleProcedure)'` per router;
`grep -l "_def.procedures" apps/api/test -r` → only
`clinical/authz.test.ts`, `booking/authz.test.ts`; all cited tests green in
B-2; clinical meta-test equality (17 = 17) proven by that green run, not by
reading.

**Owner:** pre-Phase-7 cleanup — replicate the pinning meta-test pattern across
the five remaining routers.

### F-05 · MEDIUM · Convention #1's write isolation has no table-level failing mechanism — the boundaries rule stops directory imports, not `@mesomed/db` table access

**Fact.** `eslint-plugin-boundaries` (proven live, see conformance row A#1)
polices imports between `src/modules/*` directories inside `apps/api`. But all
Drizzle table objects are exported from the shared `@mesomed/db` hub, and
nothing — lint rule, meta-test fixture, or CI check — fails if module A
imports module B's tables from that hub and writes them. Empirically the
codebase **complies today**: a write-target map of every
`.insert(/.update(/.delete(` in all module command/event/shared files shows
each module touching only tables its own schema file
(`packages/db/src/schema/<module>.ts`) defines (billing→billing_* +
facility_tiers which billing owns per the MM-PLAN-001 amendment log;
directory→providers/facilities/taxonomy; identity→profiles/roles/otp;
scheduling→schedule tables; booking→appointments; clinical→patient_* via
ordinary DML and the RLS tier via SECURITY DEFINER functions only). The
guardrail, however, detects nothing (R9 class).

**Verified by:** full read of `tooling/eslint-config/api.js` (element patterns
are `src/modules/*` / `src/kernel` only); grep write-target map across
`apps/api/src/modules/*/{commands,events}/*.ts` and `*/shared.ts` (output
preserved in audit notes; zero cross-module targets); fixture inventory of
`tooling/eslint-config/test/fixtures/` (no `@mesomed/db` fixture).

**Owner:** pre-Phase-7 cleanup or Phase 7 slice 0 — e.g. per-module schema
entrypoints + a boundaries element for them, with a failing fixture.

### F-06 · MEDIUM · Domain purity (packages/domain) has no lint rule and no failing fixture — enforced only by dependency hygiene

**Fact.** Convention/area F requires `packages/domain` to have zero DB, network
or adapter imports, verified "by lint rule and by grep", with a failing
fixture. The grep is clean: the only non-relative import in domain source is
`zod`, and `packages/domain/package.json` declares `zod` as its sole runtime
dependency (so adding `pg` would additionally require a package.json edit —
a speed bump, not a guardrail). But **no ESLint rule restricts domain
imports**: `tooling/eslint-config/base.js` restricts only
`@mesomed/platform/adapters/*`, and the boundaries config applies to
`apps/api` layout only. Nothing FAILS if a DB import lands in domain alongside
its dependency entry.

**Verified by:** `grep -rnE '^import .* from' packages/domain` filtered to
non-relative/non-zod → zero hits; full read of `base.js` `no-restricted-imports`
block; fixture directory listing (api-app only); `packages/domain/package.json`
read.

**Owner:** pre-Phase-7 cleanup — small `no-restricted-imports`/boundaries
addition + fixture in the existing meta-test file.

### F-07 · MEDIUM · PII in identity event payloads, persisted indefinitely in the outbox table

**Fact.** Against the ADR-0010 id-only standard the brief sets:
`identity.user_registered.v1` carries `phone` and `email`
(`packages/contracts/src/events/identity.ts:18-19`);
`identity.patient_profile_created.v1` carries `normalizedPhone`
(`identity.ts:39`). These payloads are written to `domain_events`, which has
**no retention/pruning policy** (F-11), so the PII persists forever in a table
outside the clinical protection tier. Checked and clean: booking payloads are
id-only snapshots (`events/booking.ts:28-39` — ids, instants, enums); billing
payloads are ids/enums/amounts (`events/billing.ts:63-77`,
`chargeIdentitySchema`); clinical payloads are ids-only by declared invariant
(`events/clinical.ts:5`) and by test (`prescriptions.test.ts:126` asserts the
serialized payload does not contain the medication name).

**Verified by:** full read of all five event contract files; the cited
prescriptions payload assertion green in B-2.

**Owner:** Phase 7 boundary decision (communication will subscribe to identity
events; contracts are additive-only per convention #3, so this needs a v2
payload or a documented retention/redaction policy — not a silent edit).

### F-08 · MEDIUM · ckb/ar search-text normalization is ABSENT from the Phase 3 directory search path

**Fact (area J asked which — it is absent).** Search matches raw input via
`ilike` on `name_en`/`name_ar`/`name_ckb` plus
`plainto_tsquery('simple', query)`
(`apps/api/src/modules/search/queries/search-listings.ts:21-24`), and the
indexer (`search/events/index-documents.ts`) applies no normalization at index
time (no hits for normalize/replace/lower beyond the SQL above). No
Arabic/Kurdish orthographic folding exists anywhere in the path (ك/ک, ي/ی,
ة/ه, آ/ا, diacritics) — variant spellings will fail to match. Trigram + GIN
indexes exist and perform (ADR-0005), but they index unnormalized text.

**Verified by:** grep for normalization functions across
`apps/api/src/modules/search`, `apps/api/src/modules/directory/queries`,
`packages/domain/directory` → zero hits; full read of
`search-listings.ts` WHERE clause.

**Owner:** Phase 7+ (or a directory follow-up slice); needs a product decision
on folding rules per locale.

### F-09 · MEDIUM · R17 early-warning check FIRES at the API layer: the doctor-facing history surface presents patient-authored allergy/blood-type data alongside prescribing data

**Fact.** `clinical.patientClinicalHistory` — a `roleProcedure("doctor")`
query (`clinical/router.ts:115-118`) — returns `medicalProfile` (bloodType,
allergies, chronic conditions) and `reportedMedications` in the same view as
`prescriptionChains` (`queries/clinical-history.ts:159-186`). This is
patient-authored, unverified data (ADR-0010 option-A: free patient upsert, no
revision history) presented on the doctor's continuity-of-care surface, i.e.
the API surface a prescribing flow would read. No web/mobile prescribing UI
exists yet (the web app is a 3-file health-check shell; zero clinical/
prescription references in `apps/web` or `apps/mobile`), so the exposure is
API-shape only today. **Scoring caveat:** R17's canonical definition lives in
the architecture risk register (MM-ARC-002), which is not on disk; this
finding states the empirical fact against the check as worded in the audit
brief. If the register excerpt says the intended state differs, re-score.

**Verified by:** file reads cited above; `grep -rln "clinical\.|prescri"`
over `apps/web/src apps/mobile` → zero hits; `find apps/web/app -name "*.tsx"`
→ 3 files.

**Owner:** Phase 7 (doctor-facing surfaces land there); at minimum label
provenance ("patient-reported, unverified") in the contract before any UI
consumes it.

### F-10 · MEDIUM · Nothing verifies production connects as `mesomed_api` — the entire clinical DB-protection tier is conditional on an unchecked deployment detail

**Fact.** Every RLS/grant/trigger proof runs by adopting the role on a raw
connection (`set role mesomed_api`, `rls.test.ts:73-80`) — correct for
testing the tier. But the API connects with whatever `DATABASE_URL` provides;
the env schema (`apps/api/src/env.ts`) validates only non-emptiness, the
`.env.example` shows a `postgres` superuser URL, and no boot check, test, or
document asserts the production role is `mesomed_api`. If production runs as
owner/superuser, the deny-all RLS and REVOKEs protect nothing (the SECURITY
DEFINER channel and audit triggers still function). This is a
false-assurance-shaped gap adjacent to the convention #6 requirement
("DB role for the API is least-privilege... in production").

**Verified by:** read of `env.ts` (no role constraint), `.env.example`
(`postgresql://postgres:postgres@...`), grep for `mesomed_api` across
`apps/api/src` → zero hits outside migrations/tests (no boot-time assertion).

**Owner:** pre-Phase-7 cleanup — a readiness-check query
(`select current_user`) asserting non-owner in production mode is cheap.

### F-11 · LOW · No retention policy for `domain_events`; pg-boss maintenance runs on unexamined defaults

**Fact.** Processed/published outbox rows accumulate indefinitely — no
pruning job, no retention config, no ADR note (grep for retention/prune across
kernel and ADR-0003 → nothing). pg-boss itself runs `supervise: true`
(`kernel/dispatcher.ts:57-62`), which archives/deletes **its own** completed
jobs on library defaults; that is configured-by-default, not decided. Retry
config is explicit and complete (retryLimit/retryDelay/exponential backoff,
dead-letter status, `redeliver()` path). Compounds F-07 (PII rows live
forever).

**Verified by:** full read of `kernel/dispatcher.ts` and `kernel/outbox.ts`;
greps cited.

**Owner:** Phase 7 (communication will multiply event volume; decide retention
then, or in the cleanup slice).

### F-12 · LOW · `.env.example` is missing two schema keys

**Fact.** `apps/api/src/env.ts` defines `WEBHOOK_RATE_LIMIT_MAX` and
`WEBHOOK_RATE_LIMIT_WINDOW_MS` (Phase 6, both defaulted); neither appears in
`apps/api/.env.example`, which otherwise matches the schema key-for-key.

**Verified by:** side-by-side read of both files.

**Owner:** pre-Phase-7 cleanup (two comment lines).

### F-13 · LOW · Gate-count documentation lags the R8 commit

**Fact.** The recorded baseline "696 tests / 79 files" (memory/gate notes)
predates `ee648d4`; the true figure on `main` is **700 / 80**. Anyone
verifying the gate against the stale number would see unexplained drift.

**Verified by:** B-2 totals; `git show --stat ee648d4` (adds exactly the one
file whose 4 tests close the gap).

**Owner:** whoever lands the next gate note; one-line update.

---

## 3. Per-area conformance table

| Area                      | Verdict                               | How verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Findings                                                                   |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A. Conventions 1–14       | Conforms with exceptions              | Per-convention table below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | F-01 (#12), F-02 (#15*), F-04/F-05 (#1/#6 depth), F-06, F-07 (#3 adjacent) |
| B. Authorization          | Conforms with gap                     | 90 procedures enumerated by grep; clinical matrix 17=17 proven by green meta-test; booking pinned; layer-b sampled + full-read in clinical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | F-04                                                                       |
| C. Clinical integrity     | **Conforms** (full read, no sampling) | RLS raw-connection suite READ IN FULL and EXECUTED green in B-2: pins exactly [encounters, prescriptions, visit_notes], zero policies, deny-all, grant-backstop; `clinical_access_log` UPDATE/DELETE rejected **as owner** (`CLINICAL_APPEND_ONLY`); prescriptions tamper/illegal-transition/DELETE rejected **as owner** (`PRESCRIPTION_IMMUTABLE`/`PRESCRIPTION_STATUS_INVALID`, `prescriptions.test.ts:272-320`); superseded→superseded→active chain asserted ordered (`history.test.ts:167-179`); R8 standing regression test exists (`audit-trigger-regression.test.ts`, commit `ee648d4`) and passed; app path uses SECURITY DEFINER channel exclusively (`clinical/shared.ts:197-382`) | F-09 (R17), F-10 (role caveat)                                             |
| D. Billing & payments     | Conforms                              | Idempotency = real DB constraints (`0005_billing.sql:86,89,90`; `0006_billing_revenue.sql:104-107`) with violation tests green; manual gateway only — FIB/ZainCash exist solely as comments/staged config ids (grep); visibility flips via directory subscribers on billing events (`directory/events/on-subscription-changed.ts`, `on-tier-payment-recorded.ts`); payloads id-only. **Facts as requested:** subscriptions are doctor-bound (`doctor_profile_id` NOT NULL + unique, `schema/billing.ts:43-51`) — **no subject polymorphism shipped**; explicit `currency` columns shipped on every money-bearing table (ADR-0009 §"everywhere-explicit-currency")                             | —                                                                          |
| E. Kernel, outbox, jobs   | Conforms with gap                     | Same-tx emit proven by commit+rollback tests (`outbox.test.ts:35-81`, green); retry/backoff/DLQ explicit; drain-timeout widening carries code comment (`seed.test.ts:39-43`) AND ADR-0007 note (line 173) — that open item is CLOSED; subscriber write-map: own-module tables only                                                                                                                                                                                                                                                                                                                                                                                                            | F-11 (retention)                                                           |
| F. Domain purity          | Grep-clean, lint-unenforced           | grep zero external imports; `zod` sole dependency; no lint rule, no fixture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | F-06                                                                       |
| G. Migrations & schema    | **Conforms**                          | Journal 0000–0007 contiguous (read); triggers/RLS/grants present in migration SQL (not only live DB — `0004:82-377`, `0007:65-267` read); zero DROP statements → rollback-note requirement vacuous (grep); table↔module ownership matches schema-file placement (write-map + `packages/db/src/schema/*` listing)                                                                                                                                                                                                                                                                                                                                                                              | —                                                                          |
| H. CI & supply chain      | Partial                               | Workflow read in full; steps genuinely execute (run history); boundaries meta-test runs in CI via workspace test task (B-2 shows it); no committed secrets (pattern grep); env example near-complete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **F-01 (red on main)**, F-03, F-12                                         |
| I. Performance discipline | Conforms (documented evidence)        | No OFFSET on any list path (grep; `browse-facilities.ts:4` documents keyset cursor); ADR-0005:105-113 records p50/p95/p99 at 200k rows (browse p95 6.7ms, search p95 20.2ms vs 100ms budget) + EXPLAIN shapes + a repeatable harness (`pnpm --filter @mesomed/api perf`). Evidence exists and is specific; the 200k-row run was **not re-executed** in this audit (documented-evidence review, stated plainly)                                                                                                                                                                                                                                                                                | —                                                                          |
| J. Scope creep vs §8      | **Conforms** / normalization absent   | Meilisearch/Redis/live gateways/analytics/REST: zero code hits (grep; Postgres-native search only); ckb/ar normalization **ABSENT** with file reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | F-08                                                                       |
| K. Documentation debt     | Mostly closed                         | ADR-0007 §3 drain note: PRESENT (line 173). Windows dev-harness notes: PRESENT (README §"Windows dev-harness notes", lines 84-90) — but README is one of the 9 format-failing files (F-01). ADR set on disk 0001–0010 matches the MM-PLAN-001 amendment log (log's latest entries record 6b + clinical-ext → ADR-0009/0010); no divergence found                                                                                                                                                                                                                                                                                                                                              | F-13, (F-01 touches README)                                                |

### Convention-by-convention (area A): where enforced, and what fails if violated

| #   | Convention                        | Failing-detection mechanism                                                                                                                                | Empirical status                                                                                                                                                     |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Module data isolation             | `boundaries/dependencies` (apps/api) + meta-test with fixtures                                                                                             | **Probed live**: scratch cross-module value import → eslint exit 1, `boundaries/dependencies`, reverted (tree confirmed clean). Gap: no table-level detection (F-05) |
| 2   | Pragmatic CQRS, outbox in same tx | `outbox.test.ts` commit/rollback pair                                                                                                                      | Green in B-2; emitter writes on caller's tx handle (`kernel/outbox.ts`)                                                                                              |
| 3   | Versioned event contracts         | `defineEvent` registry + per-module pinned event-set tests (`contracts/test/*-events.test.ts`); emit of unregistered event throws                          | Green in B-2; PII content issue is F-07, not a versioning issue                                                                                                      |
| 4   | Consistency classification        | Partial unique index `appointments_active_slot_unique` WHERE status in (booked, confirmed, checked_in, in_progress) (`0003:98`) + booking concurrency test | Index read in migration SQL; concurrency test green in B-2                                                                                                           |
| 5   | Clinical integrity                | DB triggers + owner-level denial tests (area C)                                                                                                            | **Executed** green; full detail in area C row                                                                                                                        |
| 6   | Two-layer authz + clinical RLS    | Kernel roleProcedure + layer-b checks + RLS suite                                                                                                          | Green; gaps F-04 (pinning breadth), F-10 (prod role unchecked)                                                                                                       |
| 7   | Patient identity continuity       | `packages/domain/identity/claim-policy` + claim tests                                                                                                      | Green in B-2 (domain 157 tests incl. claim-policy; api identity/claim.test.ts)                                                                                       |
| 8   | Adapter discipline                | `no-restricted-imports` ban + composition-root lift + meta-test fixtures (`uses-adapter.ts`, `app.ts` allowance)                                           | Meta-test green in B-2                                                                                                                                               |
| 9   | Config over code                  | Config tables + `packages/config` schemas; gateway registration config-only proven by `gateway-extensibility.test.ts`                                      | Green in B-2                                                                                                                                                         |
| 10  | i18n, RTL logical props           | Key-parity test (`catalogs.test.ts` — en/ar/ckb identical key sets, no empty values)                                                                       | Green; zero physical-direction CSS hits in `apps/web` (grep); web page renders from catalogs (`page.tsx:10-27`)                                                      |
| 11  | Typed error codes                 | `contracts/errors` + formatter + `errors.test.ts`; client grep                                                                                             | Green; zero message-string parsing in clients (grep — clients are still shells)                                                                                      |
| 12  | Testing DoD + CI green per slice  | GitHub CI                                                                                                                                                  | **VIOLATED — F-01** (red since Phase 6 merge)                                                                                                                        |
| 13  | No any/ts-ignore/cycles           | ESLint + grep                                                                                                                                              | Zero hits outside one sanctioned, commented `eslint-disable-next-line no-control-regex` (`symptom-triage-utils.ts:11`)                                               |
| 14  | ADR per phase                     | docs/adr on disk                                                                                                                                           | 0001–0010 present; every phase incl. 6b and clinical-ext covered                                                                                                     |
| 15  | Branch → PR → merge, protection   | Claimed: branch protection                                                                                                                                 | **VIOLATED + INERT — F-02**                                                                                                                                          |

---

## 4. Risk-register delta (vs R1–R17)

The full R1–R17 register (MM-ARC-002) is **not on disk**; only R8 is restated
in ADR-0010, and R9/R17 are defined operationally in this audit's brief. Per
the audit rules I do not infer the remaining entries — **provide the MM-ARC-002
excerpt and I will complete the mapping.** What this audit can ground:

- **R8 (clinical_audit_row CREATE OR REPLACE regression) — CONFIRMED MITIGATED.**
  The post-merge verification landed as a _standing_ regression test
  (`audit-trigger-regression.test.ts`, commit `ee648d4`) asserting the exact
  Phase-5 audit shapes across all three tables plus cross-contamination
  absence, and it passes (B-2). This is a permanent tripwire, not a one-off.
- **R9 (inert guardrails / false assurance) — RE-SCORE UPWARD.** The audit
  found the live guardrails genuinely live (boundaries lint fires on a real
  probe; RLS/immutability proven as owner; idempotency at the DB layer;
  i18n parity), **but** five new instances of the R9 class: F-02 (branch
  protection claimed, impossible), F-03 (scan steps absent), F-04 (62/90
  procedures unpinned), F-05 (no table-level isolation check), F-06 (domain
  purity unenforced). F-10 is adjacent (protection tier conditional on an
  unchecked deployment fact).
- **R17 (as operationalized in the brief) — EARLY WARNING FIRES.** F-09: the
  doctor-facing API history surface presents patient-authored allergy/
  blood-type data alongside prescription data today; no UI consumes it yet.

## 5. Prioritized remediation list (pre-Phase-7 cleanup slice)

1. **F-01** — `prettier --write` the 9 files, push, confirm CI green on
   `main`; add `format:check` to the documented local gate sequence.
2. **F-02** — Restore branch→PR workflow; correct CLAUDE.md's branch-protection
   claim to match reality (hook + discipline, or plan upgrade); add
   `git config core.hooksPath .githooks` to setup docs.
3. **F-03** — Add dependency-audit and secret-scan jobs to CI.
4. **F-04** — Procedure-pinning meta-tests for billing, directory, identity,
   scheduling, search routers (copy the clinical pattern).
5. **F-10** — Boot/readiness assertion that production runs as a non-owner DB
   role.
6. **F-05 / F-06** — Table-ownership guardrail via per-module schema
   entrypoints + boundaries element; domain-purity lint rule; failing fixtures
   for both in the existing meta-test suite.
7. **F-07 / F-11** — Decide identity-event PII posture (v2 id-only payloads
   or documented retention/redaction) before Phase 7's communication module
   subscribes; set a `domain_events` retention policy.
8. **F-09** — Obtain the R17 excerpt; at minimum add provenance labeling to
   `medicalProfile`/`reportedMedications` in the doctor-facing contract before
   any prescribing UI ships (Phase 7).
9. **F-08** — ckb/ar normalization decision + implementation for the search
   path (can ride Phase 7 or a directory follow-up).
10. **F-12 / F-13** — `.env.example` two missing keys; refresh the gate-count
    note to 700/80.

## 6. Phase 7 kickoff statement

**Phase 7 is BLOCKED.** F-01 is a Critical finding: the `main` CI gate is red
and has been since the Phase 6 merge — per the phase-discipline rule ("the
acceptance gate, not the calendar, controls sequencing; never start phase N+1
on a red gate"), no Phase 7 work should start until `main` CI is green.
The fix is mechanical (9 files of formatting), so the block is short; but the
two High findings (F-02 process integrity, F-03 missing scans) should land in
the same pre-Phase-7 cleanup slice so Phase 7 starts on an enforced, green,
scanned gate rather than a nominally green one.

---

_Audit performed read-only. Probes (one scratch lint fixture; raw-SQL probes
ran only inside the existing test suites' throwaway embedded-Postgres
databases) were reverted; `git status` on `~/mesomed` confirmed clean before
this report was written. The only file created is this report._
