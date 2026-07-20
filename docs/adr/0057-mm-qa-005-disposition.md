# ADR-0057 — MM-QA-005 disposition and remediation plan

**Status:** Accepted
**Slice:** standalone (CLAUDE.md slice discipline — audit remediation
spanning closed phases, therefore its own disposition ADR and named
slices, not a reopen of any closed phase; precedent: ADR-0031's MM-QA-004
disposition).
**Source:** `docs/qa/MM-QA-005-Full-System-Audit.md` (landed by PR #100,
point-in-time at audited revision `94fdd14`). Per audit discipline the
report is never edited after landing — every closure from this point on
is recorded here, not there.

## Owner ruling (2026-07-20)

The owner dispositioned all eight MM-QA-005 findings on 2026-07-20:

- **F-01, F-02 — fix now** (pre-store-submission; the audit's two
  Mediums).
- **F-03, F-04, F-05, F-07 — fix now**, via the slices mapped below.
- **F-06 — closed by a dated ADR-0031 amendment** (landed with this ADR):
  the launch checklist gains the `provider-registration-step2-client`
  prerequisite and the ADR-0055 translation-review scope extension.
- **F-08 — closed as a recorded deferral** via a dated ADR-0025
  amendment (landed with this ADR): Dependabot majors #57–#60 deferred
  post-launch with a revisit trigger and a CVE-escalation clause.

### Owner override (2026-07-20) — autonomous execution

The owner authorizes fully autonomous execution of this entire
remediation — branch, PR, verify CI green, squash-merge, continue — with
no per-PR approval stops. Recorded here per the ADR-0031 (2026-07-18)
override precedent. The override covers exactly the work named in the
owner's remediation prompt and nothing else; anything ambiguous,
contradictory with a locked document, or a red gate stops the run for
the owner — the override does not cover judgment calls.

Process rules bind as in the MM-QA-004 remediation: one slice = one
branch = one PR = squash-merge, no bundling beyond what is explicitly
named; `pnpm exec prettier --write` on touched files before every push;
CI evidence is `gh run view` on the merge commit on `main` (`gh run
list` is for finding run IDs only); a red `main` blocks all new work,
and a flaky test is a red gate, never blind-rerun; frozen-surface
regeneration is its own commit inside its PR; locked-document edits
(CLAUDE.md, MM-PLAN-001) are executed only as the dated amendments named
in this remediation, pre-authorized by the owner's prompt.

## Slice map

| Finding | Severity | Disposition                                                                                                                                                                                     |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01    | Medium   | **Slice 1** — add `identity.deleteAccount` to `MOBILE_CONSUMED` (33 → 34), regenerate the frozen schema surface (own commit), plus a permanent meta-test pinning the list against mobile source |
| F-02    | Medium   | **Slice 2 (Option A: filter)** — mobile excludes `coming_soon` categories from the directory grid until the tile surface lands; unit-tested; plus a dated ADR-0055 correction paragraph         |
| F-03    | Low      | **Slice 4a** — CLAUDE.md convention #15 rewritten to the amended MM-PLAN-001 wording; protection-live status recorded as the ADR-0040 close                                                     |
| F-04    | Low      | **Slice 3** — meta-test asserting `API_MODULES` equals the `apps/api/src/modules/` directory listing                                                                                            |
| F-05    | Low      | **Slice 4b** — dated MM-PLAN-001 §6 index entry covering ADRs 0050–0054, 0056, 0057                                                                                                             |
| F-06    | Low      | **ADR-0031 amendment** (this PR) — two launch-checklist items added                                                                                                                             |
| F-07    | Low      | **Folded into Slice 2's ADR-0055 edit** — the gate-citation correction lands in the same dated paragraph                                                                                        |
| F-08    | Low      | **ADR-0025 amendment** (this PR) — deferral recorded with a revisit trigger                                                                                                                     |

## Close-out

Filled by the final remediation PR: every finding's PR #, merge SHA and
`gh run view` id on that merge commit, the gate counts both sides
(pre-Slice-1 baseline vs post-Slice-4), and the register deltas.

| Finding | PR # | Merge SHA | CI run (merge commit) |
| ------- | ---- | --------- | --------------------- |
| —       | —    | —         | —                     |
