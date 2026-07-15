# ADR-0025 — Phase 10 Slice 2: supply-chain + static scanning in CI

## Status

Accepted. Phase 10 Slice 2 per MM-DES-003 §4 (ruled plan, PR #50);
policies D4 and D5 ruled by the owner 2026-07-16 (MM-DES-003 §8.1).

## Context

Phase 10 (MM-PLAN-001 §5) requires a security review layer in CI:
dependency audit (npm audit + Dependabot + CodeQL) and a secrets scan.
The repository is public (ADR-0021), which makes CodeQL and Dependabot
free — and makes the git history world-readable, so a one-time
full-history secrets scan is part of this slice, not just a
go-forward diff gate.

## Decision

### 1. Dependency-audit gate (policy D4, ruled)

`pnpm audit --prod --audit-level high` is a blocking step in the `ci`
job. High+ severity findings in production dependencies fail CI;
dev-dependency and lower-severity findings are printed by the same step
but do not block. The gate landed green — no `|| true`, no exceptions
file.

**Findings ledger at gate introduction (2026-07-16), all below the
blocking threshold, report-only:**

| Package                  | Severity | Issue                                      | Patched in |
| ------------------------ | -------- | ------------------------------------------ | ---------- |
| `esbuild`                | moderate | dev server accepts cross-origin requests   | ≥0.24.3    |
| `esbuild`                | low      | dev-server arbitrary file read (Windows)   | ≥0.28.1    |
| `postcss`                | moderate | XSS via unescaped `</style>` in stringify  | ≥8.5.10    |
| `uuid`                   | moderate | missing buffer bounds check (v3/v5/v6 buf) | ≥11.1.1    |
| `@ai-sdk/provider-utils` | low      | uncontrolled resource consumption          | ≥3.0.98    |

All five are transitive; the esbuild/postcss items are dev-server/build
-time surfaces, not production request paths. Expected resolution
channel: the weekly grouped Dependabot PR (below); none justifies an
out-of-band bump.

### 2. Dependabot

`.github/dependabot.yml`: weekly npm + github-actions ecosystems,
minor+patch grouped into one PR to keep noise at ~one PR per week.
Dependabot PRs ride the normal convention-#15 flow — CI must pass, a
human merges, **no auto-merge**: this repo's pins are load-bearing
(react 19.2.3 exact, ADR-0024 deviation #1), so a green Dependabot PR
is a proposal, not a decision.

### 3. CodeQL

`.github/workflows/codeql.yml`: javascript-typescript, `build-mode:
none`, on every PR + push to main + weekly cron. Alert policy: new
alerts surfaced on a PR are triaged before merge. Stated honestly:
branch protection is unavailable on the current GitHub plan (convention
#15), so "block" is review discipline, not a server-side rule — the
same enforcement posture as the rest of the merge gate.

Initial-run triage (2026-07-16, first analysis on the Slice 2 PR):
**zero open alerts** — nothing to disposition.

### 4. Secrets scan (policy D5, ruled)

- **CI job (`secrets`)**: gitleaks v8.27.2 (binary pinned by version
  **and** sha256) scanning the **full reachable history** on every PR.
  Deviation from MM-DES-003 §4, which sketched a diff scan: the full
  history scans in ~1s at current repo size, and a full scan is strictly
  stronger — recorded here per convention #14. If repo growth ever makes
  this slow, narrowing to a diff scan is a one-line change.
- **Findings policy (D5, ruled):** any leaked credential is rotated via
  the existing `docs/runbooks/secrets-rotation-*.md` runbooks and the
  finding recorded in this ADR. Git history is **never rewritten** —
  public clones make rewriting ineffective anyway.

**One-time full-history scan result (2026-07-16, 123 commits at
136fdd4):** exactly one finding, triaged **false positive** — a
log-redaction test's synthetic symptom marker held in a variable named
`secretText` (`apps/api/test/ai/triage-service.test.ts`, introduced in
1ecbcbb). No credential; nothing rotated. Handled belt-and-braces: the
historical fingerprint is listed in `.gitleaksignore`, and the live
line carries an inline `gitleaks:allow` so future edits to it don't
re-flag under a new fingerprint.

For completeness: a working-directory (`dir` mode) scan flags only
gitignored build artifacts (`apps/web/.next/` preview-mode keys that
Next.js generates locally per build; Expo `dist/` bundles). None are
tracked; the CI gate scans git history, which is clean.

### 5. Seeded-violation demo (Testing DoD, convention #12)

This slice is CI config; its "test" is each gate failing on a seeded
violation, demonstrated on the Slice 2 PR and then removed. Per the
owner's binding amendment (MM-DES-003 §4, 2026-07-16): the seeded
"secret" is the fake sidekiq credential from gitleaks' own README
quick-start demo (`cafebabe:deadbeef`) — a string gitleaks itself
publishes as its detection example, never anything resembling a real
credential. (AWS's documented example key `AKIA...EXAMPLE` was
considered first but is explicitly allowlisted by gitleaks' default
config — verified locally — so it cannot serve as a canary.) The
audit-gate demo seeds a known-vulnerable dependency version, not a
secret. The demo commit is dropped from the branch afterwards
(PR-branch history rewrite — this is not a rewrite of `main` and does
not conflict with D5). Evidence links are in the PR thread.

## Consequences

- Every PR now runs four independent security gates: prod-dep audit,
  CodeQL analysis, full-history secrets scan, plus the existing
  build/test CI.
- Weekly Dependabot PRs become part of routine maintenance; the
  findings ledger above is expected to drain through them.
- The secrets-scan job adds <1 min to CI wall clock (runs in parallel
  with `ci`).
- ADR-0011's crypto-shred/retention carry-over is untouched here — it
  is Slice 6 (ADR-0029) scope.
