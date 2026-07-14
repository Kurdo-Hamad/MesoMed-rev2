# ADR-0020 — Phase 9b: Doctor/Secretary Mobile Queue Views (close-out)

**Status:** Accepted
**Phase:** 9b (the ADR-0019 deferred scope: provider mobile queue views
with full lifecycle actions; walk-in booking deferred out by owner
decision — see Deferrals).
**Companions:** MM-DES-001 (Slice 1 inventory + owner decisions of
2026-07-14), ADR-0006 (lifecycle + actor matrix this phase reuses),
ADR-0013 (mobile compat policy — both pin flows exercised here),
ADR-0018 (toolchain; amended by this phase's F-04 remediation),
ADR-0019 (Phase 9a close-out), MM-QA-003 (findings F-04/F-07/F-10 all
remediated in this phase).

## What shipped (each branch → PR → CI green → merge)

0. **Consumed-i18n-key guardrail** (PR #33, `cfe5b73` — MM-QA-003
   F-10): static extraction test in `apps/mobile/test/` resolving every
   `useTranslations` binding and expanding dynamic template prefixes
   against the contracts enums; every consumed key must resolve to a
   string leaf in en/ar/ckb; unextractable patterns fail the suite;
   meta-tests prove each firing mode; 100-key liveness floor guards the
   R9 inert-guardrail class.
1. **Inventory, no code** (PR #34, `d8db8d6`): MM-DES-001 — the
   procedure→screen mapping (zero new procedures needed), the
   allowedActions design, the pin plan, and the owner's slice-review
   decisions recorded in its §8.
   — **F-04 fix** (PR #35, `ef20242`, own commit per owner instruction):
   see the F-04 section below.
2. **Server-computed `allowedActions`** (PR #36, `c1d9635` — MM-QA-003
   F-07): every `booking.clinicDay` item carries the lifecycle actions
   the calling actor may take, derived in
   `packages/domain/booking/allowed-actions.ts` from
   `APPOINTMENT_TRANSITIONS` and the actor allow-lists — which MOVED
   into the domain module so the booking router imports the same
   objects it enforces with (affordance and layer-b authz share one
   definition). Unit matrix pins all 7 statuses × 4 actor kinds;
   integration walks a live appointment through the lifecycle and
   proves an action absent from `allowedActions` is also denied by the
   mutation. Additive; `clinicDay` was in neither pin, zero pin churn.
3. **Read-only mobile queue** (PR #37, `01725af`): `/clinic` screen —
   workplace picker on `scheduling.myWorkplaces`, day list on
   `booking.clinicDay` with `allowedActions` display-only; account tab
   gates a clinic link on `identity.me` roles (navigation only, the API
   re-checks layer a/b — this ends 9a's patient-only-by-omission
   posture). Client-driven integration test on REAL sessions (Better
   Auth sign-in + `user_roles`, cookie-attached tRPC exactly as
   `app/_layout.tsx` wires it) — a first: prior api-suite tests use
   header-injected session doubles. Pin +3 (below).
4. **Queue actions** (PR #38, `dfc912a`): the six transition mutations
   wired; a button exists only when the server offers that action;
   settled transitions invalidate `clinicDay`; failures banner + refetch
   restore server truth. Per-flow client-driven integration tests:
   secretary confirm/check-in and doctor start/complete walking one
   appointment through the day, doctor no-show, secretary cancel, a
   TRUE layer-b denial (unassigned secretary — layer a passes, binding
   fails with typed `FORBIDDEN`, appointment proven untouched), and
   affordance-⊆-authz (unoffered action rejected with typed
   `INVALID_STATUS_TRANSITION`). Pin +5 (below).
5. **Patient `cancellable`** (PR #39, `fcdeb1d` — the F-07 remediation
   proper, its own unbundled slice per owner ruling): additive boolean
   on `booking.myAppointments` items from the same domain function
   (`patient_owner` binding); the patient screen's hardcoded
   `CANCELLABLE` Set is gone; per-status integration test (7 statuses).

Final counts: mobile 8 test files / 33 tests; api 62 files / 552 tests;
all slices CI-green on their PRs and on `main` after merge.

## Decisions of record

- **Affordances are server truth, single-sourced.** The actor
  allow-lists live in `packages/domain/booking` and the router imports
  them — UI affordance and layer-b enforcement cannot drift, and the
  integration suites assert the subset relation live. No MesoMed client
  now hard-codes appointment state-machine rules (the F-07 class).
- **noShow-on-checked_in divergence (deliberate).** Server truth grants
  `noShow` on a `checked_in` appointment to both clinic-side actors —
  the API has always authorized it (`checked_in → no_show` is legal,
  `noShow` is CLINIC_SIDE), but the web clinic page's hardcoded
  `DOCTOR_ACTIONS`/`SECRETARY_ACTIONS` maps never offered the button.
  Mobile renders the server truth; web is unchanged (out of 9b scope).
  Migrating web onto `allowedActions` — deleting those maps — is the
  natural follow-up when a slice next touches that page.
- **`APPOINTMENT_ACTIONS` excludes `reschedule`** (not a status
  transition; carries its own input shape). NOTE for future evolution:
  now that `clinicDay` is field-level pinned, WIDENING this enum is an
  output-loosening change — it fails the frozen schema pin by design
  and must go through the release-cut `UPDATE_FROZEN_SURFACE=1`
  regeneration, never an in-slice regen.
- **Pin history: 23 → 26 → 31.** Slice 3 added `booking.clinicDay`,
  `identity.me`, `scheduling.myWorkplaces`; Slice 4 added
  `booking.confirm/checkIn/start/complete/noShow` (`cancel` was already
  pinned). Each regeneration ran in its own commit via the gated knob,
  with a deep JSON comparison proving every previously frozen entry
  byte-identical (purely additive). The `cancellable` slice was the
  FIRST live exercise of the pin's additive path: an output field added
  to a pinned procedure with the frozen JSON untouched — exactly the
  tolerance its meta-test promised.

## Gate note — the `d8db8d6` auto-cancelled main run (binding owner condition)

Merge commit `d8db8d6` (Slice 1, docs-only) never received its own
completed CI run on `main`: the workflow's concurrency group
auto-cancelled it when the F-04 merge (`ef20242`) landed minutes later.
Coverage rationale, recorded per the owner's condition that gate gaps
are documented and never waved through silently: (a) the identical diff
was CI-green on PR #34 (run 29333621929) minutes earlier; (b) `d8db8d6`
is an ancestor of the green tip `ef20242`, whose run tested a tree
containing all of its content; (c) every subsequent `main` run
(`c1d9635`, `01725af`, `dfc912a`, `fcdeb1d`) is green. The gap is a CI
concurrency artifact, not a skipped gate; the "CI green on `main`"
definition is otherwise satisfied at every step of this phase.

## MM-QA-003 F-04 remediation (pre-Slice-2, own commit)

Every prior local gate run's turbo package tasks spawned through the
WINDOWS pnpm shim (`/mnt/c/.../npm/pnpm`) via WSL interop, because the
nvm node bin carried no pnpm shim — the plausible vector for the
ADR-0019 deviation-#6 unattributed task failure. Fixed by
`corepack enable` in the nvm node bin (environment change, nothing in
the tree can enforce it), documented as a dated ADR-0018 amendment plus
a README prerequisite note, and verified by a forced uncached
serialized full-suite run under the Linux resolution (10/10 green,
4m44s — versus ~8 minutes through the interop). Standing rule from the
amendment: any recurrence of F-03-class task-level exit-1 noise now
invalidates the interop-spawn hypothesis and must be root-caused
afresh.

## Deferrals (owner decisions 2026-07-14, recorded in MM-DES-001 §8)

1. **Walk-in booking: OUT of 9b**, deferred to its own future slice.
   The ADR-0019 stub listed it; the kickoff scope did not; the owner
   resolved the divergence by deferring, not expanding. The API it
   needs (`booking.secretaryBook`, `booking.weekAvailability`) exists
   and `weekAvailability` is already pinned.
2. **"Delay/bump late patient" is future scope after 9b.** A doctor
   choosing no-show / reschedule / delay for a late patient needs a NEW
   appointment state and NEW API — both forbidden this phase. The
   existing `noShow` and `reschedule` capabilities are unaffected; only
   the new "delay" action is deferred.
3. **Doctor encounter composers on mobile: not built — and nothing is
   missing server-side.** The read-only inventory (2026-07-14) found
   the COMPLETE composer capability already exists from Phase 5 +
   ADR-0010: `clinical.doctorEncounters`, `encounterNotes`,
   `addVisitNote`, `amendVisitNote`, `issuePrescription`,
   `amendPrescription`, `discontinuePrescription`,
   `patientClinicalHistory` — all contract-typed, typed appCodes,
   path+kind-pinned, absent from `MOBILE_CONSUMED`. A future mobile
   composer is consumption + pin work with ZERO new tRPC. Known
   friction for that future slice: no encounter-by-`appointmentId`
   lookup (clients join `doctorEncounters` on its `appointmentId`
   field), the eventual-consistency window after `booking.complete`
   (encounters are created by the `booking.completed.v1` outbox
   subscriber — the UI needs a "preparing this visit" state), and
   `doctorEncounters` is unpaginated (an optional cursor input later is
   additive).

## Human gates / untouched surfaces

Unchanged and NOT self-certified: the Phase 9a device-verification
human gate (Maestro on device, push round-trip, store builds), the
deferred mobile RTL visual review (ADR-0016 amendment — the new clinic
screens follow the same catalogs and logical-properties discipline and
ride the same deferred review), translation review, and the production
deploy checklist. No locked document was modified; MM-PLAN-001 §6's
index remains eight-plus ADRs stale (MM-QA-003 F-06, owner-owned
docs-only work, untouched here per the no-bundling rule).
