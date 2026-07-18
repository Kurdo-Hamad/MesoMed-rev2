# ADR-0043 — MM-QA-004 Slice 9: domain purity guardrail (F-09)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).
Closes MM-QA-002 F-06's long-open action.

## Context

MM-QA-004 F-09 (MEDIUM): `packages/domain` had no purity rule and no
failing fixture — its import surface had already widened from zod-only
to zod + two `@mesomed/contracts` subpaths with no guardrail deciding
what is admissible.

## Decision

- New `domainConfig` export (`@mesomed/eslint-config/domain`), adopted
  by `packages/domain/eslint.config.js`: `no-restricted-imports`
  allowlist — relative paths, `zod`, `@mesomed/contracts/phone`,
  `@mesomed/contracts/booking` (grep-verified as the only subpaths in
  use); everything else banned, including `node:*` builtins (pure logic
  only). `*.test.ts` files additionally get `vitest`; config files keep
  only the base adapter restriction. Pattern shapes account for the
  gitignore parent-directory semantics of `no-restricted-imports`
  groups (relative-specifier `!.`/`!..` negations — verified
  empirically).
- Committed failing fixtures (`test/fixtures/domain-pkg/`): db,
  platform, and node-builtin imports fail; zod + contracts subpath +
  relative pass — 4 new meta-tests (`test/domain.test.ts`).

Done-when verified (red-proof): `import { readFileSync } from
"node:fs"` in a real domain file fails lint with the purity message;
reverted clean.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1121 tests / 136 files, zero failed · build 3/3 — the Slice 8
post-slice gate on the tree that squash-merged verbatim to main
`feb0423` (CI verified green, run 29627480321).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1125 tests / 137 files, zero failed · build 3/3 (the shared-config
suite grows to 17).
