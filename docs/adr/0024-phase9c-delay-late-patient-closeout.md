# ADR-0024 — Phase 9c: Delay / Late-Patient (delay/recall) — close-out

## Status

Accepted. **Phase 9c is CLOSED.** This is the Slice 4 deliverable ruled in
MM-DES-002 §10 (D7 FINAL, 2026-07-14) as "Slice 4 — close: ADR-0021, then
STOP". Numbering note: between that ruling and this close-out, ADR numbers
0021–0023 were consumed by standalone slices (0021 gate-exception history,
0022 embedded-PG port race, 0023 dev-machine migration), so the close-out
lands as ADR-0024. No scope changed — only the number.

## What shipped (each branch → PR → CI green → merge, convention #15)

- **Slice 1 — design note, no code** (PR #41, ccd2066):
  MM-DES-002-Phase9c-Delay-Late-Patient.md; owner rulings D1–D7/D4a/EV
  recorded FINAL 2026-07-14 in its §11.
- **Slice 2 — server vertical** (PR #42, d556728): `delayed` status +
  edge set per D1 in the domain machine; `APPOINTMENT_ACTION_EDGES`
  single edge table (replacing `ACTION_TARGET_STATUS`/
  `ACTION_ALLOWED_ACTORS`); `RESCHEDULABLE_STATUSES` +
  `rescheduleTargetStatus`; contracts `APPOINTMENT_STATUSES`+1,
  `APPOINTMENT_ACTIONS`+2, `booking.delayed.v1`; migration `0009`
  (active-slot partial index + status CHECK recreated with `delayed`);
  `booking.delay`/`booking.recall` (CLINIC_SIDE per D2),
  `transitionAppointment` enforcing sources/target/actors from the same
  edge record the affordances read; reschedule-from-delayed reset +
  server-side D4a; en/ar/ckb catalog keys ×3; mobile known-action filter;
  integration tests per MM-DES-002 §9 incl. the sibling byte-identical
  immutability proof and affordance-⊆-authz; frozen-surface regen #1 as
  its own final commit (nine-entry enum-only diff, ADR-0013 release-cut
  process — the surface test deliberately red mid-PR until that commit).
- **Slice 3 — mobile consumption + full web delay/recall UI, together
  per D5/D7** (PR #43, 2475c4c, rebased onto the role-race fix): mobile
  clinic delay/recall buttons + delayed section (through the Slice 2
  known-action filter, F-07 intact); web clinic page migrated onto server
  `allowedActions` — the ADR-0020-earmarked hardcoded action maps
  deleted, all eight mutations wired, plus a static guard proving no web
  code path maps status → actions locally; first unit-test infra in
  `apps/web` (global-setup real API on embedded PG + jsdom over real
  Better Auth sessions); client-driven per-flow tests incl. a true
  layer-b denial; pin regen #2 as its own commit (`MOBILE_CONSUMED` +`booking.delay` +`booking.recall`).

Interleaved standalone slices (own ADRs/PRs per the no-bundling rule, not
9c scope): role-race fix PR #44 → 824d1c2; ADR-0021 history rewrite
PR #45 → c074113; port-race fix + ADR-0022 PR #46 → a3b4d6f; ADR-0023
machine migration PR #47 → 5b98669; ADR-0016 Phase 8 human-gate sign-off
record PR #48 → 5603e08.

## Decisions of record

All owner rulings of 2026-07-14, FINAL, recorded verbatim in MM-DES-002
§11; summarized: **D1** real `delayed` status, delay never touches
`starts_at`. **D2** delay sources `confirmed`+`checked_in`; delay/recall
CLINIC_SIDE only. **D3** `recall → checked_in`, no persisted queue
positions, delayed-at-bottom is presentation-only. **D4** reschedule from
`delayed` allowed, resets to `confirmed`. **D4a** (recommendation
overridden) patient self-reschedule from `delayed` NOT allowed in 9c —
CLINIC_SIDE only, enforced server-side. **D5** (recommendation
overridden) web + mobile built together; web delay/recall UI REQUIRED.
**D6** no auto-sweep; still-delayed rows are resolved manually. **D7**
revised slice plan (the executed one). **EV** emit `booking.delayed.v1`,
no recall event, no subscriber this phase.

## ADR-0006 amendment

The dated amendment note ruled into Slice 4's scope lands with this ADR:
ADR-0006 now carries "Amendment — 2026-07-15" recording the 8-status
machine extension, the reschedule-status exception (`delayed` →
`confirmed` reset), the D4a authorization narrowing, and the 7-event set.

## Pin ledger

- `MOBILE_CONSUMED`: 23 → 26 → 31 (Phases 9a/9b, per ADR-0020) → **33**
  (regen #2, +`booking.delay` +`booking.recall`, own commit).
- Frozen router schema surface: regen #1 (Slice 2) was the planned
  enum-only widening — nine pinned entries changed, each a `delayed`
  status-enum addition, verified entry-by-entry before regeneration;
  regen #2 (Slice 3) added the two consumed-path pins above. Both regens
  are their own commits with `UPDATE_FROZEN_SURFACE=1` scoped to the pin
  test (ADR-0013 process).

## Deviations / carry-ins (convention #14)

1. **react/react-dom pinned exact 19.2.3 workspace-wide** (Slice 3):
   under the hoisted linker (ADR-0018) web's newer caret split the
   workspace into two React copies, breaking React rendered outside
   Next's vendored copy; one exact version is the structural fix.
2. **`apps/web` unit-test infra built fresh** (Slice 3): no prior infra
   existed, so "update existing web tests" was moot; e2e specs remain
   under Playwright.
3. **i18n keys are machine translations** flagged for the deferred
   native-speaker gate (Slice 2; same posture as prior phases).
4. **Slice 3's gate history**: a local-CI-only gate exception was drafted
   during a CI billing outage but never relied upon; CI was restored by
   making the repository public, and the exception's local-green ⇒
   CI-green premise was empirically disproven by the CREATE ROLE race
   (invisible locally, fatal on CI's shared cluster). Full record in
   ADR-0021 (history) and the PR #44 findings preserved in ADR-0022.
5. **Test-harness remediations** surfaced by 9c work landed as standalone
   slices, not in 9c PRs: role-creation race (PR #44), embedded-PG port
   race + temp-dir leaks (ADR-0022).

## Deferred / carried forward (owner-required, out of 9c scope)

Per MM-DES-002 §12 and ADR-0020 §Deferrals: the notification system
(mobile push + web bell center, first consumer of `booking.delayed.v1`);
patient-initiated delay/reschedule/cancel requests (secretary-approved);
walk-in registration vertical; composer consumption; patient reschedule
UI (ADR-0016 carry-in #4); ckb/ar search-text normalization (MM-ARC-002
§1.7 carry-in); MM-PLAN-001 §6 ADR-index staleness (MM-QA-003 F-06,
owner-owned docs work).

## Human gates

Phase 8's human gates are **closed** (ADR-0016 item 9 as amended
2026-07-15, PR #48). Phase 9's device-verification human gate remains
**open and NOT self-certified**: Maestro flows on device/emulator, push
round-trip on physical devices, TestFlight/Play-internal builds + store
submission (ADR-0019 status "ready for human gate: device verification";
unchanged by 9b/9c). The deferred mobile RTL visual review and
native-speaker translation review ride the same owner deferrals as
before. Phase 9c introduces no new human gates.

## Gate verification

Slice PRs: #41/#42/#43 each CI-green on their PR before squash-merge
(Slice 3 after rebase onto the role-race fix; see ADR-0021 for the
one-time billing outage in between). This close-out PR: full serialized
local gate from WSL (format:check; lint/typecheck/test/build,
`--force --concurrency=1`) then GitHub CI green on the PR — run ids in
the PR thread.
