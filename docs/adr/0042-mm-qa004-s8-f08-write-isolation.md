# ADR-0042 — MM-QA-004 Slice 8: table-level write-isolation guardrail (F-08)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).
Closes MM-QA-002 F-05's long-open action.

## Context

MM-QA-004 F-08 (MEDIUM): convention #1 ("a module writes only its own
tables") had no table-level failing mechanism — boundaries elements were
folder-level only, and any module could import any other module's
Drizzle tables from the flat `@mesomed/db` hub with lint silent.
Compliance held by discipline alone (audit-verified: zero cross-module
table imports existed).

## Decision

1. **Per-module entrypoints**: `@mesomed/db/modules/<name>` for billing,
   booking, clinical, communication, directory, identity, kernel,
   scheduling, search — each re-exporting its own schema file plus the
   new table-free `@mesomed/db/core` (client factory + drizzle
   operators + `type SQL`). The root `.` export is unchanged (tests,
   kernel infra, and the composition root keep using it).
2. **Import migration**: all 97 files under `apps/api/src/modules/**`
   now import from their own module entrypoint (`ai`, owning no tables,
   uses `@mesomed/db/core`). The migration re-confirmed the audit: no
   module imported a foreign table — and `tsc` now proves it
   structurally (a foreign table no longer resolves from a module's
   entrypoint).
3. **Lint mechanism**: `dbIsolationOverrides(moduleNames)` in the shared
   eslint config generates a per-module flat-config override — files in
   `src/modules/<m>/**` may import only `@mesomed/db/modules/<m>` and
   `@mesomed/db/core`; the root hub, `./migrate`, `./testing`, and every
   other module entrypoint are banned (value AND type imports;
   empirically-verified `no-restricted-imports` pattern semantics: exact
   root ban via `paths`, subpath bans + own-module re-inclusion via
   `group` globs). The generator is exported and exercised by the
   meta-tests with synthetic module names, so the fixtures test the real
   generator. The base adapter-ban rule is re-included in the override
   (flat-config rule entries replace, not merge) and a meta-test pins
   that it survives.
4. **Fixtures** (committed, failing): cross-module entrypoint import and
   root-hub import fail; own-entrypoint and core imports pass — 5 new
   meta-tests (13 total in the shared-config suite).

Done-when verified (red-proof): adding
`import { encounters } from "@mesomed/db/modules/clinical"` to a billing
query fails lint with the isolation message naming the module's own
entrypoint; reverted clean.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1116 tests / 136 files, zero failed · build 3/3 — the Slice 7
post-slice gate on the tree that squash-merged verbatim to main
`b1921f2` (CI verified green, run 29626590221).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1121 tests / 136 files, zero failed · build 3/3 (the shared-config
suite grows to 13).
