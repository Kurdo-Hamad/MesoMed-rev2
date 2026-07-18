# ADR-0046 — MM-QA-004 Slice 14: mobile lib unit tests (F-14)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).
Closes MM-QA-003 remediation item 4.

## Context

MM-QA-004 F-14 (MEDIUM): the mobile pure-logic modules
`apps/mobile/lib/localized.ts` (locale pick + ckb→ar→en fallback) and
`lib/media.ts` (media-origin URL resolution) had zero tests — a Testing
DoD (convention #12) gap carried since MM-QA-003.

## Decision

Two plain unit-test files following the existing `test/rtl.test.ts`
pure-logic pattern (node environment, no harness):

- `test/localized.test.ts` (6): per-locale pick; empty-string counts as
  absent; full fallback chain ckb→ar→en; `pickOptionalText` null
  passthrough and all-empty → null.
- `test/media.test.ts` (4): host-relative prefixing, bare-path slash
  insertion, absolute http/https passthrough, non-protocol prefix not
  treated as absolute. Runs under the existing `expo-constants` stub, so
  the module's default-origin fallback is itself exercised.

## Typing note (found by the gate, fixed structurally)

The mobile typecheck runs a second pass over `tsconfig.test.json`; the
new media test pulled `lib/media.ts` into that program for the first
time (the very gap F-14 closes) and its `expo-constants` default import
failed under the test config. Fix: the test tsconfig now maps
`expo-constants` to the vitest stub (typechecking against what actually
runs) and the stub's type is widened to the optional-chain shape
consumers use.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1161 tests / 142 files, zero failed · build 3/3 — the Slice 13
post-slice gate on the tree that squash-merged verbatim to main
`d4e11a3` (CI verified green, run 29644641933).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1171 tests / 144 files, zero failed · build 3/3. An intermediate gate
ran typecheck-RED (the test-tsconfig typing note above); fixed
structurally, then this green gate.
