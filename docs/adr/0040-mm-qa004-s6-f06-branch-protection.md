# ADR-0040 — MM-QA-004 Slice 6: branch protection prepared; stale governance claims corrected (F-06)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).
**The repo-admin action itself is OWNER-ONLY and remains OPEN** — this
slice prepares the exact commands and corrects the two governance
documents; nothing here applies protection or claims it is applied.

## Context

MM-QA-004 F-06: `main` has no branch protection; enforcement is the
versioned pre-push hook plus discipline. Two governance texts are wrong
about this posture in opposite directions:

- MM-PLAN-001 §3 convention #15 justifies the hook-only posture with
  "branch protection is unavailable on the current GitHub plan" — stale:
  the repository is public, where branch protection is available on
  every plan (verified: `gh api repos/Kurdo-Hamad/MesoMed-rev2` →
  `"visibility": "public"`).
- MM-ARC-002 §10.2 states "Branch protection on `main` requires them
  [the CI checks]" — a claim of protection that does not exist.

## Decision

### 1. Prepared owner command (NOT executed by this slice)

Applying protection is a repo-admin action reserved to the owner (plan
rule: confirm before applying; override: prepare only). The exact call,
requiring a PR and the four CI jobs the gate already treats as the
green condition, admins included, force-pushes and deletions blocked:

```sh
gh api -X PUT repos/Kurdo-Hamad/MesoMed-rev2/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["ci", "e2e", "docker", "secrets"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false
}
JSON
```

Notes for the owner:

- `required_approving_review_count: 0` requires the PR mechanism without
  requiring an approval a solo owner cannot give their own PR.
- `strict: true` requires branches to be up to date with `main` before
  merge — matches the rebase-before-gate discipline already practiced.
- `required_linear_history` is false because squash-merges already
  produce linear history; flip to true if desired.
- Verify afterwards: `gh api repos/Kurdo-Hamad/MesoMed-rev2/branches/main/protection --jq '{checks: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled, prs: (.required_pull_request_reviews != null)}'`
- The pre-push hook stays as belt-and-braces (protection guards GitHub;
  the hook guards the local clone before network).

### 2. Governance corrections (dated amendments, this slice)

- MM-PLAN-001 §3 #15: the stale "unavailable on the current GitHub
  plan" justification is replaced with the true posture — protection is
  available (public repo) and its application is an open owner action
  per this ADR; until applied, the hook remains the only tooling
  enforcement. Marked with a dated amendment note referencing this ADR.
- MM-ARC-002 §10.2: "Branch protection on `main` requires them" is
  corrected to state that branch protection requiring these checks is
  prepared (this ADR) and owner-applied; the sentence no longer asserts
  a control that is not yet active.

**Delegated ruling under owner override — ratification pending**: both
documents are locked; the remediation plan's Slice 6 explicitly
prescribes these two corrections ("amend … to state the true posture;
doc edits ride the same slice ADR"), so the edits execute the
owner-approved plan rather than resolve anything new. A different owner
ruling reopens them here as a dated amendment.

## Consequences

- Once the owner runs the prepared call, convention #15's "no direct
  pushes" gains server-side enforcement; the F-06 finding closes fully.
  Until then the finding is remediated to "prepared + documents
  truthful", with the application step OPEN on the owner list.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
979 tests / 132 files, zero failed · build 3/3 — the Slice 5 post-slice
gate on the tree that squash-merged verbatim to main `37ad13f` (CI
verified green, run 29624679386).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
979 tests / 132 files, zero failed · build 3/3 — unchanged, as expected
for a docs-only slice.
