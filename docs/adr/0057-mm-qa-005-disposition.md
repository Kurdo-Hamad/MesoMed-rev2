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

## Close-out (2026-07-20)

Every MM-QA-005 finding is closed. All six PRs merged autonomously under
the 2026-07-20 override, each with its full local gate both sides and
its merge commit CI+CodeQL-verified green on `main` before the next
slice began.

| Finding(s)    | PR   | Merge commit | CI run (merge commit)                                                                                                                                                               |
| ------------- | ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report landed | #100 | `c832ed5`    | CI [29723577014](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29723577014) · CodeQL [29723576979](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29723576979) |
| F-06 + F-08   | #101 | `477ddbf`    | CI [29724340055](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29724340055) · CodeQL [29724340059](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29724340059) |
| F-01          | #102 | `39b42b4`    | CI [29740794844](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29740794844) · CodeQL [29740794969](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29740794969) |
| F-02 + F-07   | #103 | `645edd1`    | CI [29742254858](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29742254858) · CodeQL [29742254909](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29742254909) |
| F-04          | #104 | `3830e19`    | CI [29742951418](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29742951418) · CodeQL [29743663818](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29743663818) |
| F-03 + F-05   | #105 | `0685e15`    | CI [29745281179](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29745281179) · CodeQL [29745281270](https://github.com/Kurdo-Hamad/MesoMed-rev2/actions/runs/29745281270) |

### A defect caught mid-remediation (not an original audit finding)

Slice 1's guard test initially imported `MOBILE_CONSUMED` from
`router-schema-surface.test.ts` directly. Importing a `.test.ts` file's
export re-executes its top-level `describe`/`it` calls under the
importing file's vitest module scope: the new guard silently
double-counted the surface test's 4 tests (reported 5 tests from a file
with exactly one `it()` block; the api suite's total jumped by +5
instead of the expected +1). Caught locally before push by reconciling
the observed count against the known baseline (776/81, itself
re-verified independently via a git-overlay check) rather than trusting
the gate's green exit code alone. Fixed by moving `MOBILE_CONSUMED` into
a plain module, `apps/api/test/contracts/mobile-consumed.ts` — the guard
test's final, merged form reports exactly 1 test.

### Final gate

Pre-Slice-1 baseline (post-PR#101, `477ddbf`): format GREEN ·
lint/typecheck 20/20 · test 11/11 tasks, **1256 tests / 160 files, zero
failed** · build 3/3 — the ADR-0056 post-slice count, reconfirmed
unchanged by the two doc-only PRs (#100, #101).

Post-Slice-4 (local, WSL, 2026-07-20, after PR#104 `3830e19` merged):
format GREEN · lint/typecheck 20/20 · test 11/11 tasks, **1262 tests /
163 files, zero failed** · build 3/3. Delta: api 776→777 (+1, F-01's
guard test), mobile 50→54 (+4, F-02's `category-filter.test.ts`),
eslint-config 19→20 (+1, F-04's sync test) — every other package
unchanged. PR#105 (F-03 + F-05) is doc-only and does not move these
counts.

### Register deltas

F-01 through F-08 are all closed. The still-open register is unchanged
in kind from MM-QA-005 §4: HG-1..HG-5, D10 (including the F-04 runbook's
final flip), native-speaker ar/ckb translation review (now explicitly
scoped to ADR-0055's strings per the ADR-0031 amendment above), mobile
RTL visual review, the `provider-registration-step2-client` follow-up
slice (now a named launch-checklist prerequisite), the billing pricing
decision for the three unpriced provider types, and the Dependabot
majors #57–#60 (now a recorded post-launch deferral per the ADR-0025
amendment above, revisit trigger D10 + 2 weeks, CVE-escalation
exception). None of these were touched by this remediation — they were
correctly open before it and remain correctly open after it.
