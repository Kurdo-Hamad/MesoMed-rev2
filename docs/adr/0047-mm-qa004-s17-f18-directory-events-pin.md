# ADR-0047 — MM-QA-004 Slice 17: directory event-set pin (F-18)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).

## Context

MM-QA-004 F-18 (LOW): directory was the only module without a pinned
event-set test in `packages/contracts/test` — its 5 event contracts
were registered only via the composition root, so a renamed or dropped
contract would surface at runtime, not in the contracts suite.

## Decision

`packages/contracts/test/directory-events.test.ts` mirrors the
identity/booking/clinical/billing pins: exact sorted name-set assertion
(the 5 v1 events), clean registry composition, and representative
parse/reject cases (facility snapshot round-trip, doctor-profile
required-field rejection, taxonomy enum boundaries).

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1173 tests / 144 files, zero failed · build 3/3 — the Slice 16
post-slice gate on the tree that squash-merged verbatim to main
`b05d625` (CI verified green, run 29647714718).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1178 tests / 145 files, zero failed · build 3/3.
