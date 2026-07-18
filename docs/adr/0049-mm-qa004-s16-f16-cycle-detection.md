# ADR-0049 — MM-QA-004 Slice 16: import-cycle detection (F-16)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).

## Context

MM-QA-004 F-16 (LOW): convention #13's "no barrel-file cycles" clause
had no detection mechanism — no `no-cycle` rule anywhere, cycle absence
never verified.

## Decision

- `import-x/no-cycle` (maxDepth 8) enabled in the shared base config —
  every workspace inherits it.
- **Two settings were required to make the rule real, both verified
  empirically and both in base**: `import-x/resolver` (import-x v4 reads
  its own settings namespace — the legacy `import/resolver` key is
  honored by eslint-plugin-boundaries' resolve util, not by import-x)
  and `import-x/parsers` mapping `@typescript-eslint/parser` to
  `.ts/.tsx` (no-cycle must parse the IMPORTED files to build export
  maps; without the mapping it silently finds nothing — the inert-
  guardrail trap this remediation keeps meeting).
- Committed failing fixture (`src/modules/cyclic/a.ts ⇄ b.ts`) + 2
  meta-tests: the cycle fails lint with `import-x/no-cycle`; acyclic
  module files stay clean.
- Full-repo sweep after enabling: `turbo run lint --force` 10/10 —
  **zero existing cycles** (nothing to report to the owner; the audit's
  "cycle absence was not verified" is now verified and enforced).

Done-when verified: a temporary two-file cycle in a real workspace
(`packages/contracts`) reported "Dependency cycle detected"; removed.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1171 tests / 144 files, zero failed · build 3/3 — the Slice 15
post-slice gate on the tree that squash-merged verbatim to main
`84508b2` (CI verified green, run 29646765901).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1173 tests / 144 files, zero failed · build 3/3 (the two cycle
meta-tests).
