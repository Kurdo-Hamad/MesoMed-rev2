# ADR-0041 — MM-QA-004 Slice 7: authz enumeration pins across all routers (F-07 + F-19)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).
Closes MM-QA-002 F-04's long-open action.

## Context

MM-QA-004 F-07 (MEDIUM): only clinical (17) and booking/scheduling
(mutations only) carried procedure-pinning meta-tests; every other
router's denial coverage was hand-maintained with nothing failing when
a new procedure shipped uncovered — the exact drift F-04 predicted, and
the communication and ai modules were added with no pin at all. F-19
(LOW): three of communication's four authenticated procedures had no
anonymous-denial test.

## Decision

The clinical pattern — a MATRIX of `{procedure, kind, deniedRoles}`
entries diffed against the live router's `_def.procedures` (so an
unmatrixed procedure fails the suite), plus per-entry anonymous→401 and
role→403 assertions — is now on **every** router, with the
`access: "public"` variant (introduced in ADR-0039's identity pin) for
public procedures, which are asserted never auth-rejected.

Coverage: billing 25 (1 public, 24 role-guarded) · directory 25 (11
public, 14 admin) · communication 5 (the F-19 4-entry authenticated
matrix + admin `listRecentNotifications`) · ai 1 · search 1 · system 2
· booking 14 and scheduling 8 (pins upgraded from mutations-only to
full-surface — queries included) · identity 11 (ADR-0039) · clinical 17
(original). Total: **109 procedures pinned**; the only unpinned
procedure is `health.check`, the public liveness probe on the health
router, intentionally outside the denial-matrix scope. Existing
layer-b (ownership) and invariant tests in the reshaped files were all
kept.

Done-when verified: removing a matrix entry (communication) makes the
enumeration pin fail with the missing path named; restoring it returns
green — a new unpinned procedure cannot ship.

## Tests

Extended/reshaped: `billing/authz.test.ts`, `directory/authz.test.ts`,
`booking/authz.test.ts`. New: `communication/authz.test.ts`,
`ai/authz.test.ts`, `search/authz.test.ts`, `system-authz.test.ts`.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
979 tests / 132 files, zero failed · build 3/3 — the Slice 6 post-slice
gate on the tree that squash-merged verbatim to main `d5230df` (CI
verified green, run 29625665200).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1116 tests / 136 files, zero failed · build 3/3 (api 733/75 with the
new matrices).
