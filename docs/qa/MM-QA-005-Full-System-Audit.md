# MM-QA-005 — Full-System Audit (post-remediation, post-multi-country)

|                      |                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**             | 2026-07-19                                                                                                                                                                                                                                                                                                                |
| **Audited revision** | `main` @ `94fdd145622a5e562f5791e724a4c42f9711620c` (clean tree throughout; `git status --porcelain` empty before and after the audit — this report is the only file written)                                                                                                                                             |
| **Working copy**     | WSL clone `~/mesomed` (authoritative per CLAUDE.md Development environment); node v22.23.1, pnpm 11.10.0                                                                                                                                                                                                                  |
| **Scope**            | The entire system: Phases 0–10 plus everything since — the MM-QA-004 remediation (PRs #72–#97, ADRs 0031-amendments through 0054), the owner-override period, the multi-country catalog (ADR-0055, PR #98), and the vocabulary-drift closure (ADR-0056, PR #99). Open PRs and Dependabot PRs out of scope by instruction. |
| **Audited against**  | MM-PLAN-001 (as amended), MM-DEC rev02, MM-ARC-002, CLAUDE.md conventions #1–#15, ADRs 0001–0056, the Testing DoD                                                                                                                                                                                                         |
| **Method**           | Empirical per MM-QA-004 precedent: every claim carries HOW it was verified (command + result, file:line, or preserved log). Full uncached local gate as evidence baseline; CI evidence via `gh run` on merge commits on `main` only. Audit only — zero fixes applied.                                                     |

**Special-attention areas (per the audit brief), beyond the MM-QA-004
checklist:** (A) remediation verification — do the 28 MM-QA-004 closures
hold; (B) override-period cohort quality (PRs #76–#97 merged autonomously);
(C) multi-country new surface; (D) the known-open register.

## Severity scale (MM-QA-001 precedent, "launch" as the horizon)

- **Critical** — an architecture invariant or phase gate is silently unmet.
- **High** — verified-broken core capability, or debt that corrupts launch.
- **Medium** — real gap; contained today, costs grow if carried into launch.
- **Low** — hygiene/documentation debt; cheap now, noise later.

---

## 1. Baseline runs (evidence appendix)

All executed from `~/mesomed` in WSL, serialized, at `94fdd14`, clean tree.
Gate run uncached (`--force` on every turbo stage); full log preserved at
`~/mm-qa5-scratch/gate.log` (10 328 lines, `GATE EXIT: 0`).

| #   | Command                                            | Result                                                                                                               | Evidence                                                                             |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| B-1 | `pnpm format:check`                                | **GREEN** — exit 0 (first stage of the `&&`-chained gate; chain reached completion)                                  | `~/mm-qa5-scratch/gate.log`                                                          |
| B-2 | `pnpm exec turbo run lint typecheck --force`       | **GREEN** — 20/20 tasks, 0 cached, exit 0                                                                            | gate.log (`Tasks: 20 successful, 20 total`)                                          |
| B-3 | `pnpm exec turbo run test --concurrency=1 --force` | **GREEN** — 11/11 tasks, **1256 tests / 160 files, 0 failed**, exit 0                                                | gate.log (`Tasks: 11 successful, 11 total`; per-package summaries below)             |
| B-4 | `pnpm exec turbo run build --force`                | **GREEN** — 3/3 tasks, exit 0                                                                                        | gate.log (`Tasks: 3 successful, 3 total`)                                            |
| B-5 | CI on the audited HEAD                             | **GREEN** — CI run 29689612456 `success` (jobs secrets, e2e, docker, ci all `success`); CodeQL 29689612496 `success` | `gh run list --branch main` headSha `94fdd14`; `gh run view 29689612456 --json jobs` |

Per-package test counts (B-3): api 776/81 · domain 198/24 · contracts 72/10 ·
mobile 50/11 · config 39/6 · platform 35/9 · web 37/8 · db 22/7 ·
eslint-config 19/2 · i18n 8/2 = **1256 tests / 160 files**.

**Baseline drift reconciliation — fully accounted, zero unexplained drift.**
MM-QA-004 B-3 was 948/126 at `f3be3e8`. The chain of on-disk records:
remediation close-out final gate 1194/147 (ADR-0031 close-out amendment,
after `2cf13d3`) → ADR-0055 post-slice 1246/156 (+52 tests / +9 files) →
ADR-0056 post-slice 1256/160 (+10 tests / +4 files: db 20→22, contracts
69→72, api 771→776). This audit's B-3 reproduces ADR-0056's recorded count
exactly, per package. The MM-QA-004 F-26 complaint (no gate count recorded
on disk) is fixed in practice: every slice ADR since records both sides.

---

## 2. Findings

Ordered by severity; each is fact → evidence → owner. Numbering is this
audit's own (MM-QA-004's findings are always cited as "MM-QA-004 F-xx" —
the cross-audit numbering confusion recorded in MM-QA-004 F-07 is not
repeated here). **No Critical and no High findings.** The MM-QA-004
remediation holds empirically (area A table), the override cohort is clean
(area B table), and the gate is green at every layer. What follows is two
Mediums on the new multi-country/mobile seam and six Lows.

### F-01 · MEDIUM · The ADR-0013 mobile-compat schema pin was not extended for `identity.deleteAccount` — a shipped mobile screen calls a procedure whose I/O schema is not frozen

`apps/mobile/app/(tabs)/account.tsx:65` calls
`trpc.identity.deleteAccount.useMutation()` (shipped by MM-QA-004 Slice 3a,
PR #75, merge `36039eb`). The mobile-consumed census is now 34 procedures;
`MOBILE_CONSUMED` in `apps/api/test/router-schema-surface.test.ts:42` still
pins 33 — the diff is exactly `identity.deleteAccount`. MM-QA-004 area C
verified these two lists IDENTICAL at 33; every prior consumption growth
extended the pin in the same PR (four additive commits on
`frozen-schema-surface.json` pre-`f3be3e8`), and that file has **zero
commits since `f3be3e8`**. Consequence: a breaking change to the
account-deletion input/output — a store-mandated flow — passes the schema
pin, the exact drift ADR-0013 exists to catch. Mitigations bounding
severity: the identity enumeration pin (F-07 mechanism) still forces denial
coverage, the path/kind pin still forbids removal, and no mobile release has
been cut (HG-1 open), so nothing deployed can break yet.

- **Evidence:** `grep -rhoE 'trpc\.[a-zA-Z]+\.[a-zA-Z]+' apps/mobile/app
apps/mobile/lib | sort -u` → 34 entries; pinned list extracted from
  `router-schema-surface.test.ts` → 33; `diff` → `> identity.deleteAccount`
  (sole line). `git log f3be3e8..HEAD -- apps/api/test/contracts/frozen-schema-surface.json`
  → empty. `git log -S deleteAccount -- apps/mobile` → `36039eb` (#75).
- **Owner:** One additive `MOBILE_CONSUMED` + regen entry (the established
  e54d24f pattern). Consider a meta-test diffing the pinned list against the
  mobile-source grep so this class fails CI instead of an audit.

### F-02 · MEDIUM · Deferred-visible categories are dead-end tiles on mobile: the IQ-pinned app renders `medical_marketplace` and `online_consultation` as ordinary categories with an empty browse and no coming-soon state

`directory.listCategories` returns every active category row including the
two gated `coming_soon` (`list-taxonomies.ts:113`); mobile filters only on
`active` (`apps/mobile/app/directory/index.tsx:19`) and never reads
`status` (zero `status` hits across mobile directory screens). A mobile
user therefore sees "Medical marketplace" / "Online consultation" tiles,
taps through to `directory/[category].tsx`, and gets the generic empty
state (`:56-58` — `t("empty")`, "no results" semantics), in all three
locales; mobile's only `comingSoon` catalog namespace is the ADR-0019
country-level state, not a category state. ADR-0055 recorded the deferral
("mobile is untouched this slice… adopts the tile surface later") — but two
of its assertions do not survive contact with mobile: "the Coming Soon
landing is the only reachable state by construction" (§2) is web-only, and
"unaffected by the additive `status` field" (§8) is type-true but
behaviorally false — mobile gained two dead-end tiles the moment the rows
were seeded, `status` field or not. Nothing is bookable or leaked
(zero providers seeded, facilities have no booking path), so this is a
launch-UX defect plus an ADR overstatement, not an integrity breach.

- **Evidence:** `list-taxonomies.ts:93-115` (no status filter, gating
  fail-open to `active`); `directory/index.tsx:17-19`;
  `directory/[category].tsx:23-58`; `grep -n status` over the three mobile
  directory screens → zero; `grep -rn comingSoon apps/mobile/app` → country
  state only; seed `data.ts:2319` (`DEFERRED_CATEGORIES`, zero providers).
- **Owner:** Mobile slice — either filter `coming_soon` out of the mobile
  category grid until the tile surface lands, or render the coming-soon
  state; plus a one-paragraph ADR-0055 correction of the two overstatements.

### F-03 · LOW · CLAUDE.md convention #15 still carries the pre-ADR-0040 justification ("branch protection is unavailable on the current GitHub plan") — now doubly false: the plan text was amended and protection is live

ADR-0040 (Slice 6) corrected MM-PLAN-001 §3 #15 (line 102, dated amendment)
and MM-ARC-002 §10.2 (line 618) but missed the third site its own source
finding (MM-QA-004 F-06) had cited by line: `CLAUDE.md:32`. Since then the
owner applied protection — `main` now has a live rule requiring status
checks ci, e2e, docker, secrets — so the per-session governing file asserts
protection is _unavailable_ while it is in fact _enforced_. CLAUDE.md's own
header rule ("if anything in this file conflicts with MM-PLAN-001,
MM-PLAN-001 wins — update this file to match") makes the fix mandatory, not
optional. Direction of the error is benign (understates enforcement — no
false assurance), hence Low.

- **Evidence:** CLAUDE.md:32 read verbatim; MM-PLAN-001:102 amended text +
  its §6 entry; MM-ARC-002:618 corrected text; `gh api graphql` →
  `branchProtectionRules: [{pattern: "main", requiresStatusChecks: true,
requiredStatusCheckContexts: ["ci","e2e","docker","secrets"]}]`.
  MM-QA-004 F-06 evidence line cites `CLAUDE.md:32` explicitly.
- **Owner:** One-line CLAUDE.md edit to mirror the amended MM-PLAN-001 #15;
  optionally record the protection-applied date as the ADR-0040 close.

### F-04 · LOW · The F-08 write-isolation guardrail contains its own hand-maintained list: `API_MODULES` has no failing sync mechanism against the filesystem

`tooling/eslint-config/api.js:10-20` hard-codes the nine module names and
its own comment concedes the risk: "Adding a module without listing it here
leaves that module's `@mesomed/db` imports unguarded — keep in sync with
the filesystem." Nothing fails when they diverge: no test reads
`apps/api/src/modules/` and diffs it against `API_MODULES` (grep for
`API_MODULES` → definition + one use + one comment; no `readdir` anywhere
in the config or its tests). The list is complete today (nine names = nine
module dirs, verified), so this is the R9-lite class — a guardrail correct
by discipline — inside the very slice (ADR-0042) that closed MM-QA-002
F-05's identical complaint at the table level. New modules are rare and
PR-reviewed, hence Low rather than Medium.

- **Evidence:** `api.js:6-20,160`; `ls apps/api/src/modules/` → ai,
  billing, booking, clinical, communication, directory, identity,
  scheduling, search (9 = 9); `grep -rn API_MODULES tooling/ apps/api/test/`
  → 3 hits, none a sync assertion.
- **Owner:** Tooling — a 5-line meta-test (readdir vs list) in
  `boundaries.test.ts`, or generate the list from the filesystem.

### F-05 · LOW · MM-PLAN-001 §6's ADR index is stale again: remediation ADRs 0050–0054 fall outside the recorded "0032–0049" range, and ADR-0056 is unlogged (F-17 recurrence)

The 2026-07-18 reconciliation entry (landed for MM-QA-004 F-17) indexes
"`0032`–`0049` the MM-QA-004 remediation slices" — but five remediation
ADRs were numbered later (0050 F-12, 0051 F-13, 0052 doc bundle, 0053 i18n
trio, 0054 F-25) and are outside every §6 entry; ADR-0056 (which changed
db-schema derivation and billing vocabulary) has no entry at all (`grep -c
0056 MM-PLAN-001` → 0). ADR-0055 is properly logged (the 2026-07-19
amendment). The close-out PR #97 updated ADR-0031 but not the §6 index. The
gap is 6 ADRs — far smaller than the 20 MM-QA-004 found, and the finding →
PR map in ADR-0031 compensates — but the recurrence two days after the
reconciliation shows the index has no update trigger.

- **Evidence:** MM-PLAN-001:238 ("0032–0049" phrasing) and 239–241 (last
  entries: 084214e note, F-15 note, ADR-0055); `grep -c 0056` → 0; `ls
docs/adr/` → 0050–0056 on disk.
- **Owner:** Owner — extend the next §6 touch to 0050–0056; consider making
  "§6 entry" a line item in the slice-ADR template so the index cannot
  stall silently.

### F-06 · LOW · The launch checklist (ADR-0031) was not amended for the post-close-out surface: neither the `provider-registration-step2-client` prerequisite nor ADR-0055's machine-drafted-strings gate appears in the go/no-go instrument

ADR-0055 names the step-2 client form a "named pre-launch follow-up slice…
which must land before any non-IQ provider onboarding" and declares its new
ar/ckb strings "an explicit open human gate"; both are also in the
MM-PLAN-001 §6 amendment. But ADR-0031 — the checklist HG-5 is decided on,
which the F-01 precedent established must enumerate every launch item —
carries neither (`grep step2|step-2|provider-registration docs/adr/0031*`
→ empty; its open-items list still scopes the translation gate to "Slices
3b, 5, 19"). This is the F-01-omission class at much lower stakes: the
items are recorded loudly in two governing documents, just not in the one
the go/no-go reads.

- **Evidence:** ADR-0055:37-38,136-144,231-238; MM-PLAN-001:241; grep of
  ADR-0031 as above; ADR-0031 close-out "What remains OPEN" list read.
- **Owner:** Owner — one dated ADR-0031 amendment adding both items (step-2
  conditional on non-IQ onboarding preceding launch; translation-review
  scope extended to ADR-0055's strings).

### F-07 · LOW · ADR-0055's gate section cites CI on branch head `23d03f1`, but the merged PR #98 head was `928ef0e` — the recorded evidence names the wrong commit

PR #98's true head is `928ef0e` (2 commits; `23d03f1` then `928ef0e`,
which is the doc-only "record the PR CI run in the gate section" commit —
the self-reference added after the cited run). Verified compensatingly: CI
and CodeQL are `success` on `928ef0e` too, and the merge commit `9a30777`
is CI+CodeQL green on `main`, so nothing unverified merged — the defect is
purely that the ADR's evidence line does not name the commit that merged
(and cannot, since the commit edits the ADR; the honest form is "CI green
on the branch, final run on the merge commit").

- **Evidence:** `gh pr view 98 --json headRefOid,commits` → head
  `928ef0e`, last commits `[23d03f1, 928ef0e]`; `git show --stat 928ef0e`
  → 1 file, ADR-0055 only; `gh run list --commit 928ef0e…` → CI success,
  CodeQL success; run 29687283182 `success` on merge `9a30777`.
- **Owner:** Docs-only correction whenever ADR-0055 is next touched; for
  future slices, cite the merge-commit run (the close-out pattern) rather
  than a branch-head run.

### F-08 · LOW · The four deferred Dependabot major bumps (#57–#60) have no recorded deferral decision anywhere — the "deferral" exists only as unmerged PRs

PRs #57 (lucide-react-native 0.550→1.24), #58 (typescript 6.0→7.0), #59
(@ai-sdk/anthropic 2.0→4.0), #60 (tailwindcss 3.4→4.3) have been open
since 2026-07-16 with zero comments, no labels, and no mention in any ADR,
doc, or commit (`grep -rn` for the PR numbers and package majors across
`docs/` → nothing; ADR-0025 defines the Dependabot process but predates
them). The audit brief calls them "deferred", and deferring majors through
a launch window is defensible — but under this project's own standard
(ADR-0031: deferral triggers must be recorded; MM-QA-004 F-13's complaint
was precisely an undispositioned deferral) an unwritten deferral is drift
waiting to be rediscovered. The PRs themselves are out of audit scope; the
missing record is the finding.

- **Evidence:** `gh pr list --state open` → #57–#60 + #70; `gh pr view 57
--json createdAt,comments` → created 2026-07-16, comments `[]` (same for
  #58); docs grep → ADR-0025 process text only.
- **Owner:** Owner — one paragraph (ADR-0025 amendment or the next doc
  bundle): defer-until-post-launch with a revisit trigger, or schedule
  them.

---

## 3. Per-area conformance tables

Verdicts: HOLDS / HOLDS-WITH-GAP / CONFORMS / CONFORMS-WITH-GAP /
VIOLATION / OPEN-AS-RECORDED.

### A — Remediation verification: the 28 MM-QA-004 closures at `94fdd14`

Every High spot-verified empirically; Mediums and Lows verified against
their closing artifact. "HOLDS" = the fix exists on disk, matches its ADR,
and its guardrail (where one was the fix) is live in the gate.

| MM-QA-004 finding                      | Verdict        | Evidence (command/file:line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-01 password recovery (High)          | HOLDS          | Patient + provider flows in identity router (`router.ts:202-221` provider phone leg `resetProviderPasswordByOtp` public + rate-limited; admin path retained at `:183` as exceptional); web `auth/forgot-password` + `auth/reset-password` routes exist; mobile `auth/forgot-password.tsx` exists; `password-recovery.test.ts` in identity suite; checklist amended (ADR-0031 2026-07-18 amendment)                                                                                                                                                                                                                                                           |
| F-02 deletion + policies (High)        | HOLDS          | `commands/delete-account.ts` (self-only; directory listing retired via CASCADE + subscriber, `:21-24`, ADR-0038); mobile account screen wires `deleteAccount` mutation (`account.tsx:65`) + privacy/terms links (`:31-35`); web `[locale]/privacy` + `[locale]/terms` pages; content merged as DRAFT pending owner+counsel (ADR-0034:7,48-49) — correctly not self-certified                                                                                                                                                                                                                                                                                 |
| F-03 alerts/runbooks (High)            | HOLDS          | `alert-rules.yaml`: heartbeat-absence rule (`:117-128`, fires via `noDataState: Alerting`), both other `noDataState` values now carry ADR-0037 rationale comments (`:20-28,66-77`); all six §10.9 incident runbooks on disk (`ls docs/runbooks/` → incident-api-down, -db-degraded, -outbox-stalled, -provider-outage, -otp-abuse, -data-breach); HG-2 scope extension recorded (ADR-0031 amendment)                                                                                                                                                                                                                                                         |
| F-04 id-only events + redaction (High) | HOLDS          | All 4 emit sites v2 (`complete-provider-signup.ts:78`, `claim-patient-profile.ts:103`, `create-guest-patient-profile.ts:62`, `ensure-patient-registration.ts:24`); v1 schemas retained read-only (`events/identity.ts:15-17`); migration `0010_redact_identity_event_pii.sql` (idempotent jsonb key removal); runbook row 22 rewritten honestly — "production verification lands with deploy (D10)"                                                                                                                                                                                                                                                          |
| F-05 appCode classification (High)     | HOLDS          | `apps/web/lib/booking-error.ts` switches on `error.data?.appCode === ErrorCode.SLOT_UNAVAILABLE`; parameter type omits `message` so reading it is a type error; repo-wide `rg '\.message\.(includes                                                                                                                                                                                                                                                                                                                                                                                                                                                          | startsWith | match | indexOf)'` over both clients → zero |
| F-06 branch protection (Med)           | HOLDS+         | Protection now LIVE (GraphQL: rule on `main`, required contexts ci/e2e/docker/secrets — the owner executed the prepared ADR-0040 action); MM-PLAN-001:102 + MM-ARC-002:618 corrected. Residual: CLAUDE.md:32 stale → **this audit's F-03**                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F-07+F-19 authz pinning (Med)          | HOLDS          | Enumeration pins in 10 files: ai/billing/booking/clinical/communication/directory/search authz + `system-authz.test.ts` + `identity/authz.test.ts:99-104` (matrix diffed against `router._def.procedures` — a new procedure fails); scheduling covered via `booking/authz.test.ts`; CI green ⇒ post-remediation procedures (recovery, deleteAccount, listHomepageTiles) are all matrixed                                                                                                                                                                                                                                                                     |
| F-08 write isolation (Med)             | HOLDS-WITH-GAP | `@mesomed/db` exports `./core` + `./modules/*` (package.json); `api.js:24-49` bans the root hub + cross-module entrypoints; fixtures `uses-db-root.ts`/`uses-db-core.ts`/cross-module pair exist and the boundaries meta-test runs in the gate (eslint-config 19/2 green). Gap: hand-maintained `API_MODULES` → **this audit's F-04**                                                                                                                                                                                                                                                                                                                        |
| F-09 domain purity (Med)               | HOLDS          | `tooling/eslint-config/domain.js:77-88` — `no-restricted-imports` allowlist (`zod`; +`vitest` for tests); `packages/domain/eslint.config.js` consumes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F-10 adapter ban real path (Med)       | HOLDS          | `packages/platform/package.json` exports `"."` + `"./adapters"` (split landed); ban targets the real concrete entrypoint (ADR-0044), fixtures updated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F-11 statement timeouts (Med)          | HOLDS          | Migration `0011`: `ALTER ROLE mesomed_api SET statement_timeout='10s' / lock_timeout='5s' / idle_in_transaction_session_timeout='30s'` (`:26-28`, the ADR-0045 delegated values); pool-level mirror in `packages/db/src/client.ts:48`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F-12 clinical list bounds (Med)        | HOLDS          | Migration `0012_clinical_read_bounds.sql` — new LIMIT-honoring function with cursor semantics (`p_limit`, `:24-56`); shipped as a NEW migration (F-21 rule respected)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F-13 ar/ckb normalization (Med)        | HOLDS          | `packages/domain/search/normalize-search-text.ts` + its test file; reindex migration `0013_search_text_normalization.sql`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F-14 mobile lib tests (Med)            | HOLDS          | `apps/mobile/test/localized.test.ts` + `media.test.ts` on disk; mobile suite now 50/11 (was 40/9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F-15..F-28 (Lows)                      | HOLDS          | Spot-verified: no-cycle rule `base.js:63` (F-16); `directory-events.test.ts` + `identity-events.test.ts` in contracts/test (F-18); 72 h check inside `0014_support_grant_window_cap.sql:29` (F-20); `I18nManager` in mobile `book/[slug].tsx:268` (F-22); hardcoded-placeholder rg → zero (F-23); web `i18n-consumed-keys.test.ts` (F-24); search p95 panel + 50k row alert (`api-latency.json:103,131`; `alert-rules.yaml:182-224`) with threshold reconciled to 100 ms in MM-ARC-002:92 (F-25); `.env.example` carries all 6 keys (F-26); marketplace comments gone from `packages/domain` (F-27); §6 log entries for F-15/F-17/F-28 (MM-PLAN-001:238-240) |
| Delegated rulings 1–7 (override)       | MATCH          | 1: provider deletion kept, listing retired (`delete-account.ts:21-24`); 2: `account_deleted` v2 additive (`events/identity.ts:120,138`); 3: recovery shape as recorded (router `:202-221`); 4: the two doc corrections landed (:102/:618); 5: 10s/5s/30s in `0011:26-28`; 6: `OTEL_METRIC_EXPORT_INTERVAL` in `.env.example`, not `env.ts`; 7: 100 ms in MM-ARC-002:92                                                                                                                                                                                                                                                                                       |

### B — Override-period cohort (PRs #76–#97, merged autonomously)

| Probe                                                     | Verdict  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every merge commit CI-green on `main` (the plan's rule 3) | CONFORMS | `gh run list --branch main` → CI **and** CodeQL `success` for all 22 cohort merge commits `cdf2d4a`…`65604e2` (plus `9a30777`, `94fdd14`), each headSha matched individually against the close-out map                                                                                                                                                                                                                                                                         |
| Close-out map accuracy (finding → PR → merge commit)      | CONFORMS | `gh pr list --json number,mergeCommit` #76–#97 diffed against the ADR-0031 close-out table → every oid matches                                                                                                                                                                                                                                                                                                                                                                 |
| One slice = one branch = one PR; no bundling              | CONFORMS | PR titles/files map 1:1 to slices; the two multi-concern PRs were both pre-authorized: #77 (masking fix + override amendment — the amendment is the authority itself) and #91 (Slice 15 doc bundle + clock pin, both named in the override amendment). #83's `.gitignore` line (`.claude/worktrees/`) is the only out-of-slice touch found — tooling hygiene, noted, not scored                                                                                                |
| No guardrail weakening                                    | CONFORMS | Cohort diff greps: added `.skip(`/`.todo(`/`.only(` → zero; added `eslint-disable` → zero; test-timeout bumps → zero (sole hit is an asserted 1000 ms timeout _value_ in the F-11 test); `frozen-router-surface.json` + `frozen-schema-surface.json` → zero commits since `f3be3e8` (no regens; the surface pin is additive-only by design, so untouched = unweakened). The known flake (`seed.test.ts` drain) was left un-bumped and recorded — the override contract honored |
| No test theater (guardrails actually fire)                | CONFORMS | Every new guardrail ships a committed failing fixture or meta-test that runs in the gate: boundaries fixtures (`uses-db-root.ts` etc.) + eslint-config suite 19/2 green; enumeration pins are self-firing (matrix vs live router); ADR-0056 is explicit about its one green-by-design lock (honest note in §"Gate closure")                                                                                                                                                    |
| Locked docs edited only per plan prescription             | CONFORMS | The two locked-doc edits (MM-PLAN-001:102, MM-ARC-002:618) execute Slice 6's own prescription, recorded as delegated ruling 4; MM-DEC rev02 untouched (`git log f3be3e8..HEAD -- MM-DEC*` → the file has no cohort commits)                                                                                                                                                                                                                                                    |
| Migrations: new files only (F-21 rule)                    | CONFORMS | `git log --follow` shows migrations 0000–0009 untouched in the cohort; every cohort DB change is a new file (0010–0014); 0015 is #98                                                                                                                                                                                                                                                                                                                                           |
| Human gates untouched                                     | CONFORMS | Close-out "What remains OPEN" enumerates them; no cohort artifact marks HG-1..HG-5/D10/translation/RTL done; 3b legal text merged flagged DRAFT (ADR-0034:7)                                                                                                                                                                                                                                                                                                                   |
| Residuals found by this audit                             | —        | F-01 (MOBILE_CONSUMED, originated in pre-override #75), F-03 (CLAUDE.md miss in Slice 6), F-04 (API_MODULES list in Slice 8), F-05 (§6 index not extended by #97)                                                                                                                                                                                                                                                                                                              |

### C — New surface: multi-country catalog (ADR-0055) + vocabulary closure (ADR-0056)

| Item                                                        | Verdict           | Evidence                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Country scoping — browse/homepage (no cross-country rows)   | CONFORMS          | `browse-facilities.ts:39-43`, `browse-doctors.ts:41-45`, `homepage-feed.ts:51-55,124` all subquery `cities join countries where iso_code = ${country}`; NULL-city doctors excluded as recorded (ADR-0055 §5)                                                                                                                                                                        |
| Country scoping — search                                    | CONFORMS          | `search-listings.ts:45` `eq(searchDocuments.countryIso, country)`; router applies `assertCountryActive` first (`search/router.ts:16-17`); NULL `country_iso` rows excluded as recorded; indexer writes `countryIso` (`index-documents.ts:34,49,74,88`)                                                                                                                              |
| Fail postures implemented as argued                         | CONFORMS          | `packages/config/src/index.ts`: country gating fails **closed** (`:29,58` — NOT_FOUND ⇒ `coming_soon`), category gating/display fail **open** (`:73,94,139` — NOT_FOUND ⇒ `{}`/`null` ⇒ active/full list); only `NOT_FOUND` absorbed in each — other config failures propagate, exactly the ADR-0055 §2 argument                                                                    |
| Deferred categories truly inert (no booking/indexing paths) | CONFORMS (web)    | Zero providers seeded (`data.ts:2319` comment + census); facilities have no booking path (booking rides doctor schedules); web `/directory/[category]` serves Coming Soon + `robots: noindex` (`page.tsx:33,42`); nothing indexed (no rows to index); billing fail-closed for the 3 unpriced types (D row below)                                                                    |
| Coming-soon states in all three locales                     | CONFORMS-WITH-GAP | `comingSoon` blocks present in en/ar/ckb at both namespaces (`messages/*.json:136,463`); key-parity test green in gate. Gap: **mobile has no category-level coming-soon state at all** → finding F-02                                                                                                                                                                               |
| Web country switcher / cookie context                       | CONFORMS          | `country-switcher.tsx:25` filters `status === "active"`; cookie `mesomed-country` default IQ forwarded as header (ADR-0055 §8; `x-mesomed-country` wiring verified in slice diff)                                                                                                                                                                                                   |
| Seed matches rulings (countries, tiles, AE, Chamchamal)     | CONFORMS          | `data.ts:2244-2294` IR/IN/TR/JO/DE + AE rows (AE `coming_soon`); `NON_IQ_TILES` = exactly the ruled five (`:2327-2334`); `NON_IQ_DISPLAY_COUNTRIES` the ruled set; IQ deliberately unlisted (fallback)                                                                                                                                                                              |
| ADR-0056 defect fixes                                       | CONFORMS          | CHECK derived from `DIRECTORY_PROVIDER_TYPES` (`schema/directory.ts:208-214`); seed preflight (`scripts/seed/preflight.ts` reusing `expectedMigrationCount`, same comparison as `kernel/health.ts:56-57`); billing exclusion pinned (`contracts/billing.ts:251-…`) with fail-closed rejection (`provider-billing-config.ts:44`); no migration 0016 — correct, per its own reasoning |
| §8 override scope held (no marketplace domain built)        | CONFORMS          | Repo grep: no marketplace tables/events/modules; the override is exactly a taxonomy row + tile + landing, logged in MM-PLAN-001:241                                                                                                                                                                                                                                                 |

### D — Known-open register (must be open and loud, not silently drifted)

| Register item                                          | Verdict          | Evidence                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider signup step-2 gap                             | OPEN-AS-RECORDED | No client form exists (`countryCode` absent from both signup forms); every signup defaults `IQ`; named follow-up slice recorded in ADR-0055:136-144 **and** MM-PLAN-001:241. Loudness gap: absent from the ADR-0031 checklist → finding F-06                                                                      |
| Billing pricing exclusion for the 3 new provider types | OPEN-AS-RECORDED | `BILLING_EXCLUDED_PROVIDER_TYPES` (`billing.ts:251`) with reason comment; `setProviderBillingModel` rejects typed `VALIDATION` (`provider-billing-config.ts:44`) — fail-closed; disjointness + union assertions live in contracts + api suites (gate green); ADR-0056 marks it "OPEN decision awaiting the owner" |
| Machine-drafted ar/ckb pending native review           | OPEN-AS-RECORDED | ADR-0055 §9 explicit ("PENDING NATIVE-SPEAKER REVIEW… not marked done by this ADR"); standing gate in ADR-0031 open list covers Slices 3b/5/19; nothing anywhere marks review done. Loudness gap: the ADR-0031 list predates 0055's strings → folded into F-06                                                    |
| F-04 runbook production verification pending D10       | OPEN-AS-RECORDED | Runbook row 22 states it verbatim ("production verification lands with deploy (D10)"); close-out amendment lists "F-04 runbook final flip" under owner-only OPEN                                                                                                                                                  |
| Deferred Dependabot majors #57–#60                     | OPEN, NOT LOUD   | All four still open, untouched — but **no recorded deferral decision exists anywhere** → finding F-08                                                                                                                                                                                                             |

---

## 4. Launch blockers vs accepted debt (before HG-5)

### A. Still-open human gates (all correctly open, none self-certified)

Unchanged in kind from ADR-0031's close-out list, re-verified at `94fdd14`:
HG-1 (store submission — legal DRAFT must clear owner+counsel first),
HG-2 (Grafana/OTLP + heartbeat rule + synthetic probes + `SENTRY_DSN`,
now also the ADR-0054 search panels/alert), HG-3 (backup drill), HG-4
(archive), HG-5 (go/no-go), D10 (deploy — carries the F-04 runbook final
flip and `verify:db-role`), native-speaker ar/ckb review (now spanning
Slices 3b/5/19 **plus ADR-0055's strings**), mobile RTL visual review.
Branch protection — MM-QA-004's F-06 owner action — is **done** (live rule
verified). The retention prune job and store data-safety forms ride D10/HG-1
as before.

### B. Added by this audit — close or disposition before HG-5

1. **F-01 `MOBILE_CONSUMED` gap** (Medium) — one additive pin entry;
   should land before HG-1 cuts the first mobile release, because the pin
   is the only schema-compat control that release has.
2. **F-02 mobile dead-end tiles** (Medium) — a small mobile change (filter
   or coming-soon state) before stores ship the IQ app with two dead
   tiles; plus the two-sentence ADR-0055 correction.
3. **F-06 checklist completeness** (Low, but HG-5-adjacent) — the go/no-go
   instrument must enumerate the step-2 prerequisite and the 0055
   translation scope, or HG-5 is deciding on an incomplete list — the
   exact failure mode the F-01 precedent established.

### C. Accepted / carry-safe (a ruling away from legitimate debt)

- **F-03 CLAUDE.md line, F-05 §6 index, F-07 ADR-0055 citation** — three
  doc-only corrections; one bundle PR covers all three (plus F-06's
  amendment if the owner prefers one PR).
- **F-04 `API_MODULES` sync** — 5-line meta-test at leisure; list verified
  complete today.
- **F-08 Dependabot majors** — one recorded paragraph makes the deferral a
  decision instead of an accident.

**Bottom line.** The MM-QA-004 remediation is real: all 28 closures hold
under empirical re-verification, the delegated rulings match what shipped,
and the override-period cohort shows none of the failure modes autonomous
merging risks — every merge commit is CI-green, no guardrail was weakened,
no scope was smuggled. The multi-country surface implements its ADR as
argued (scoping, fail postures, inert deferrals) with one real seam gap:
the untouched mobile app now renders two dead-end tiles (F-02) and one
mobile-consumed procedure escaped the compat pin (F-01). Nothing found is
Critical or High; nothing blocks HG-1..HG-5 mechanically beyond what was
already open. The two Mediums are small, pre-store-submission fixes; the
six Lows are one docs bundle plus two five-line guards.

---

_Audit performed read-only from `~/mesomed` (WSL) at `94fdd14`, clean tree
throughout (`git status --porcelain` empty before this report was written).
No fixes applied; no commits or pushes; open PRs and locked documents
untouched. The only file written to the repository is this report. Gate
evidence preserved outside the repo at `~/mm-qa5-scratch/gate.log`. CI
evidence retrieved live via `gh` (REST + GraphQL) against
`Kurdo-Hamad/MesoMed-rev2` with no degradation incidents this session._
