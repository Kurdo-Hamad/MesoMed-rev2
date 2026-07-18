# ADR-0044 — MM-QA-004 Slice 10: adapter ban on the real import path (F-10)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).

## Context

MM-QA-004 F-10 (MEDIUM): the shared lint config banned
`@mesomed/platform/adapters/*` — a subpath that did not exist — while
every concrete vendor adapter was root-exported from
`@mesomed/platform` alongside the interfaces module code is told to
import. Any module could import a live vendor adapter with lint silent;
compliance held by discipline alone (audit-verified: all 22 wiring
references were in the composition root).

## Decision

- **Split entrypoints**: new `@mesomed/platform/adapters` exports ONLY
  the five concrete vendor factories (`createMetaWhatsAppAdapter`,
  `createTwilioSmsAdapter`, `createExpoPushAdapter`,
  `createResendEmailAdapter`, `createAnthropicAiGateway`) and their
  option types, removed from the root. The root keeps interfaces,
  mocks, the manual gateway, and `isMockAdapter` — everything module
  and test code legitimately imports.
- **Composition root** (`apps/api/src/app.ts`) imports vendor factories
  from the adapters entrypoint; the existing composition-root lint
  exemption covers it.
- **The ban is now the real path**: `platformAdapterRestriction` bans
  `@mesomed/platform/adapters` (and subpaths) everywhere outside the
  composition root — including inside the per-module isolation
  overrides, pinned by meta-test.
- **Fixtures on the real path**: the violation/allowance fixtures now
  import `createTwilioSmsAdapter` from `@mesomed/platform/adapters`.
- Repo sweep: no other importer of a vendor factory existed; web and
  mobile test fixtures import only mocks (root) — typecheck-verified.

Done-when verified (red-proof): importing `createTwilioSmsAdapter` from
`@mesomed/platform/adapters` in a communication module file fails lint
with the composition-root message; `app.ts` still passes.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1125 tests / 137 files, zero failed · build 3/3 — the Slice 9
post-slice gate (PR #85's tree).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1125 tests / 137 files, zero failed · build 3/3 — counts unchanged
(entrypoint split + fixture rewiring; no new tests).
