# ADR-0018 — Phase 9a Slice 0: Mobile Toolchain, Linker Posture, RTL Gate

**Status:** Accepted
**Phase:** 9a (Patient-facing Expo mobile app — MM-PLAN-001 §5; Phase 9b
doctor/secretary queue views explicitly out of scope)
**Builds on:** ADR-0001 §6 / ADR-0003 deviation #4 (prior isolated-vs-hoisted
linker note), ADR-0002 F-09 (missing mobile CI build coverage), ADR-0013
(mobile API compatibility policy, frozen surface), ADR-0016 items 9–10
(RTL sign-off halt and numeric-date screenshot carry-in).

## Decision 1: node-linker — empirically hoisted, not isolated

Prior notes assumed pnpm 11 silently ignores `.npmrc`'s `node-linker=hoisted`
and defaults to isolated linking. This slice verified the mechanism, not just
the symptom: **pnpm 11 moved this setting out of `.npmrc` into
`pnpm-workspace.yaml`'s `nodeLinker` key.** The `.npmrc` line has been dead
since Phase 0 day one (`35e9c26`) while the workspace ran isolated-linked the
entire time (`pnpm config get node-linker` returned `undefined` reading the
stale `.npmrc`; setting the same key in `pnpm-workspace.yaml` was picked up
immediately).

Empirical evidence isolated linking is broken for this stack (Expo SDK 57 /
Metro / React Native 0.86 on pnpm 11.10.0):

- `expo export --platform web` failed: `Unable to resolve module
react-fast-compare` — a phantom dependency of expo-router's vendored
  `react-helmet-async`, present in the pnpm store but not hoisted to a
  location Metro's resolver walks.
- `expo export --platform ios` failed the same way on a different phantom
  dependency: `whatwg-fetch`, required by `@expo/metro-runtime`'s native
  entry point.

After a clean reinstall (`rm -rf **/node_modules && pnpm install`) with
`nodeLinker: hoisted` set in `pnpm-workspace.yaml`, both platforms plus
`--platform android` exported cleanly, and the full workspace gate
(`format:check` → `lint`+`typecheck` → `test --concurrency=1` → `build`) was
re-run forced-uncached and stayed green — the linker change has no
regression on `apps/api` or `apps/web`. **Decision: `nodeLinker: hoisted` in
`pnpm-workspace.yaml` is the verified posture going forward.** The stale
`.npmrc` `node-linker=hoisted` line is removed; a comment there and in
`pnpm-workspace.yaml` points at this ADR so the next linker question starts
from evidence, not the old assumption.

## Decision 2: expo export closes the CI build gap (ADR-0002 F-09)

`apps/mobile/package.json` gains a `build` script:
`expo export --platform web --platform ios --platform android`. No CI
workflow change was needed — `apps/mobile` already participates in the
existing `ci` job's `pnpm build` (turbo `build` task), which previously
no-op'd for mobile because no `build` script existed; turbo's existing
`outputs: ["dist/**", ...]` already covers Expo's default export directory.
Green CI now actually exercises a mobile bundle build for all three
platforms from this slice onward.

## Decision 3: RTL sign-off resolved; numeric-date regeneration deferred

ADR-0016 item 9 (RTL sign-off halted for the owner) is **resolved
2026-07-13**: the owner reviewed `docs/rtl-review/phase8/` and approved the
existing screenshot set as-is. Item 10 (screenshots still show pre-fix
dates — ckb's English month-name fallback, ar's `yyyy/mm/dd` order) is
**deferred, not resolved** — the owner's decision is that this gap is
non-blocking for now; regeneration will happen alongside a future broader
Kurdish date-formatting effort, out of scope for Phase 9a. See ADR-0016's
own dated amendment to items 9–10 for the authoritative record.

Separately — and independent of the deferral above — this slice found that
ADR-0016 item 10's stated blocker ("no working headless-browser renderer,
missing system libraries, no sudo") no longer holds. Playwright's Chromium
needs shared libraries (`libnspr4`, `libnss3`, and others) that normally
require `apt install`; without interactive sudo in this environment,
`apt-get download <pkg>` (fetch-only, no root required) followed by
`dpkg-deb -x <pkg>.deb <dir>` (extract-only, no root required) into a scratch
directory, with that directory's `lib/x86_64-linux-gnu` added to
`LD_LIBRARY_PATH`, is sufficient to launch headless Chromium and render
mixed-script RTL content correctly (verified with an ar+ASCII-digit mixed
sample: connected Arabic letterforms, correct RTL line direction, ASCII
digits embedded left-to-right as expected). This is recorded here as a
capability, not exercised further this slice — no screenshots were
regenerated, per the deferral decision above.

## Verification

- `pnpm --filter @mesomed/mobile typecheck / lint / test` — green, before
  and after the linker switch.
- `expo export --platform web`, `--platform ios`, `--platform android` —
  all three fail under isolated linking, all three succeed under hoisted.
- Full workspace gate (`format:check`, `lint`+`typecheck`, `test
--concurrency=1`, `build`) — forced uncached, green under hoisted linking
  across all 14 workspace projects.
- Headless-renderer capability spike — Chromium launches and renders
  correct RTL/mixed-script output via the no-sudo library-extraction
  workaround (see Decision 3); not wired into any checked-in script this
  slice, since it was not needed to satisfy the (deferred) RTL regeneration
  item.

## Amendment — 2026-07-14: MM-QA-003 F-04 remediation (gate tasks spawned the Windows pnpm shim)

MM-QA-003 F-04 found a toolchain blind spot this ADR did not examine: the
nvm node bin (`~/.nvm/versions/node/v24.16.0/bin`) carried no pnpm shim,
so bare `pnpm` resolved through the WSL interop `PATH` to the **Windows**
npm-global shim (`/mnt/c/Users/Lenovo/AppData/Roaming/npm/pnpm`). The
documented `corepack pnpm` covered only the top-level invocation — turbo
re-resolves `pnpm` from `PATH` for every package task, so every local
gate run spawned its tasks across the Windows interop boundary (a
plausible vector for the ADR-0019 deviation-#6 unattributed task-level
`exited (1)`; version skew was ruled out, both shims were pnpm 11.10.0).

**Remediation (2026-07-14):** `corepack enable` run in the nvm node bin.
`which pnpm` under the documented gate `PATH` now resolves to the Linux
shim (`~/.nvm/versions/node/v24.16.0/bin/pnpm`, 11.10.0, matching the
`packageManager` pin); corepack also installs `pnpx`/`yarn` shims as a
side effect (unused, harmless). Verified by a forced uncached serialized
full-suite run under the new resolution, all tasks green (log
`/tmp/f04-forced-gate-run.log`). This is an **environment** fix — nothing
in the repo tree enforces it, so every WSL clone setup must run
`corepack enable` once after installing node (README Prerequisites now
says so). CI was never affected (Linux runners, `pnpm/action-setup`).
Per MM-QA-003 F-04's disposition, any recurrence of F-03-class
task-level exit-1 noise after this fix invalidates the interop-spawn
hypothesis and must be root-caused afresh.

## Scope note

This ADR covers Slice 0 only (the toolchain gate for the rest of Phase 9a).
Slices 1–6 (app shell, browse/search, guest booking, auth + biometric,
dashboard + push, release rails + e2e) are tracked separately and will each
land via their own branch → PR → CI-green → merge, per convention #15. Phase
9b (doctor/secretary queue views) remains explicitly out of scope for this
phase.
