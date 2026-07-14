# MM-DES-001 — Phase 9b Slice 1: Provider Mobile Queue — Inventory & Slice Plan

|             |                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**    | 2026-07-14                                                                                                                                        |
| **Status**  | Design note (Slice 1 deliverable — no code). Slice boundaries below await owner approval.                                                         |
| **Scope**   | Phase 9b: doctor/secretary mobile (Expo) queue views with full lifecycle actions, per the ADR-0019 "Phase 9b (deferred scope)" stub.              |
| **Sources** | ADR-0006 (lifecycle + role gates), ADR-0013 (mobile compat policy), ADR-0019, MM-QA-003 F-07/F-10, code cited by file:line at `main` @ `cfe5b73`. |

Hard constraints restated from the kickoff: **no new tRPC procedures**
(additive output fields permitted where pin-safe per ADR-0013);
frozen-pin updates only via the `UPDATE_FROZEN_SURFACE=1` flow in their
own commit; **no state-machine rules hard-coded in the client**
(MM-QA-003 F-07); i18n via en/ar/ckb catalogs only; thin client.

## 1. Existing API surface to reuse (procedure → mobile use)

Layer-a roles are the `roleProcedure(...)` arguments; layer-b actor
allow-lists are the named constants in
`apps/api/src/modules/booking/router.ts:46-54`
(`CLINIC_SIDE` = assigned_secretary/owning_doctor/admin, `FRONT_DESK` =
assigned_secretary/admin, `DOCTOR_ONLY` = owning_doctor/admin,
`ANY_PARTY` = those plus patient_owner), enforced by
`assertAppointmentActor` (`shared.ts:172-196`).

| Procedure                  | Kind     | Layer a (roles)                   | Layer b (actors)                                                           | Mobile use                                                                                                                      |
| -------------------------- | -------- | --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `scheduling.myWorkplaces`  | query    | doctor, secretary                 | self (assignments/ownership resolved in query)                             | Workplace picker; its `relation` field (`owning_doctor` \| `assigned_secretary`) selects the doctor vs secretary affordance set |
| `booking.clinicDay`        | query    | doctor, secretary, admin          | owning_doctor / assigned_secretary / admin (`queries/clinic-day.ts:33-45`) | The queue screen data source (per-item: id, instants, status, bookedVia, patient name/phone, note)                              |
| `booking.confirm`          | mutation | secretary, doctor, admin          | `CLINIC_SIDE`                                                              | Queue action: booked → confirmed                                                                                                |
| `booking.checkIn`          | mutation | secretary, admin                  | `FRONT_DESK`                                                               | Queue action (secretary): confirmed → checked_in                                                                                |
| `booking.start`            | mutation | doctor, admin                     | `DOCTOR_ONLY`                                                              | Queue action (doctor): checked_in → in_progress                                                                                 |
| `booking.complete`         | mutation | doctor, admin                     | `DOCTOR_ONLY`                                                              | Queue action (doctor): in_progress → completed                                                                                  |
| `booking.noShow`           | mutation | secretary, doctor, admin          | `CLINIC_SIDE`                                                              | Queue action: confirmed/checked_in → no_show                                                                                    |
| `booking.cancel`           | mutation | patient, secretary, doctor, admin | `ANY_PARTY`                                                                | Queue action (already mobile-pinned for the patient app)                                                                        |
| `booking.secretaryBook`    | mutation | secretary, admin                  | assignment check inline (`router.ts:91-100`)                               | Walk-in booking form (if in scope — open question 1)                                                                            |
| `booking.weekAvailability` | query    | public                            | —                                                                          | Walk-in slot picker (already mobile-pinned)                                                                                     |
| `identity.me`              | query    | authenticated                     | self                                                                       | Role-aware entry routing (mirrors `apps/web/.../dashboard/shell.tsx:18,34`)                                                     |

**Encounter note.** "Doctor starts/completes" maps to
`booking.start`/`booking.complete` appointment transitions. Encounters
are created exclusively by the `booking.completed.v1` subscriber
(`clinical/events/on-booking-completed.ts:17-47`, idempotent on
`appointment_id`); no encounter-open command exists, and the doctor
encounter composers (`clinical.addVisitNote`, `issuePrescription`, …)
are **out of 9b queue scope** unless ruled in (open question 3).

Transition write + event emission are one transaction
(`commands/transition-appointment.ts:41-82`); only
confirmed/cancelled/completed/no_show emit events — `checked_in` and
`in_progress` are silent (ADR-0006 §7), so no communication side
effects change with 9b.

## 2. The web queue view being mirrored

`apps/web/app/[locale]/dashboard/clinic/page.tsx` — a single shared
doctor+secretary page: `myWorkplaces` picker (>1 → select), `clinicDay`
list, six transition mutations each invalidating `clinicDay`, and a
secretary-only walk-in form (`secretaryBook` + `weekAvailability`).
Status labels are `web.dashboard.status_${status}`, action labels
`web.dashboard.action_${action}` — already present in all three
catalogs, so mobile reuses the `web.dashboard` namespace with near-zero
new keys (per the ADR-0019 one-catalog-two-renderers decision; the new
Slice 0 extraction test enforces whatever mobile consumes).

**Divergence we must not copy:** the web page hard-codes the
status→actions maps client-side (`DOCTOR_ACTIONS`/`SECRETARY_ACTIONS`,
`page.tsx:87-98`). In an atomically-deployed web client that is
tolerated; in a shipped binary it is exactly the MM-QA-003 F-07 failure
mode. The mobile queue must instead render from server data (§3).

## 3. The one additive API change: server-computed `allowedActions`

`clinicAppointmentItemSchema` (`packages/contracts/src/booking.ts:124-135`)
carries only raw `status`; no server-computed action/`cancellable`
field exists anywhere yet (repo-wide grep — F-07's flag is proposed,
not implemented). Design:

- **Contract:** additive `allowedActions` array on each `clinicDay`
  item — enum of `confirm | checkIn | start | complete | noShow |
cancel`. Additive output field ⇒ pin-safe per ADR-0013; `clinicDay`
  is not in either frozen pin today, so there is no pin churn at all
  for this change.
- **Computation:** a pure function in `packages/domain/booking`
  (`allowedAppointmentActions(status, actorKinds)`), derived from the
  existing `APPOINTMENT_TRANSITIONS` map (`transitions.ts:17-25`) and
  the same actor allow-lists the mutations enforce, so UI affordance
  and authz can never drift. `getClinicDay` already resolves the
  caller's actor binding (`clinic-day.ts:33-45`) and passes it in.
- **Client rule:** the mobile queue renders exactly the buttons named
  in `allowedActions` — zero client-side status Sets/conditionals.
  (The web page can adopt the same field later; not part of 9b.)
- **Adjacent (owner call, open question 2):** the same mechanism
  trivially yields the `cancellable` flag on `booking.myAppointments`
  that MM-QA-003 F-07 proposes for the patient app. Additive output
  fields pass the frozen schema pin without regeneration (proven by the
  ADR-0019 pin's additive-tolerance meta-test), but it remediates a 9a
  finding, so per the no-bundling rule it rides 9b only if the owner
  rules it in scope.

## 4. Frozen-pin impact (ADR-0013)

New mobile-consumed procedures at the end of 9b: `booking.clinicDay`,
`booking.confirm`, `booking.checkIn`, `booking.start`,
`booking.complete`, `booking.noShow`, `scheduling.myWorkplaces`,
`identity.me` (+ `booking.secretaryBook` if walk-in is in scope).
Process per ADR-0013/ADR-0019: each procedure is added to the literal
`MOBILE_CONSUMED` list (`apps/api/test/router-schema-surface.test.ts:42-66`)
**in the same PR as the screen that consumes it**, and
`frozen-schema-surface.json` is regenerated via the
`UPDATE_FROZEN_SURFACE=1` knob **in its own explicit commit**,
documented in the PR and the closing ADR. Never silently.

## 5. Mobile auth / role routing

Mobile auth is patient-only **by omission** today: sign-in routes to
`/account` with no role inspection anywhere (`app/auth/sign-in.tsx:10-15`,
`app/(tabs)/account.tsx`). Providers can already authenticate with
phone+password (same identity API as web). 9b adds role-aware routing
after sign-in via `identity.me` roles — doctor/secretary land on the
clinic queue surface, patients see the unchanged app. No provider
sign-up on mobile (stays web, matching the web sign-in's provider tab
split). Layer-a/b enforcement is entirely server-side already; the
client routing is convenience, mirroring the web shell's posture
(`shell.tsx:9-13`).

## 6. Proposed slice boundaries (await owner approval)

| Slice                           | Content                                                                                                                               | Test DoD                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2 — API (additive only)**     | `allowedActions` on `clinicDay` items: domain function + wiring in `getClinicDay`; `cancellable` on `myAppointments` **iff ruled in** | Unit tests on the domain function (every status × actor kind); integration: clinicDay as doctor vs secretary vs admin asserts per-status action sets; existing pins stay green untouched |
| **3 — Mobile queue, read-only** | Role-aware entry (`identity.me`), workplace picker (`myWorkplaces`), clinic-day list (`clinicDay`) with status chips + day paging     | Client-driven integration test (live server + PG): provider signs in on the real mobile client, lists a seeded clinic day; pin-update commit (3 procedures)                              |
| **4 — Mobile actions**          | The six transition mutations wired to `allowedActions`-driven buttons, invalidation mirroring web                                     | One client-driven integration test per action flow (confirm, check-in as secretary; start, complete as doctor; no-show; cancel) incl. a layer-b denial; pin-update commit                |
| **5 — Walk-in (iff in scope)**  | Secretary walk-in form on `secretaryBook` + `weekAvailability`                                                                        | Client-driven integration test: walk-in books a seeded slot, appears in clinicDay; pin-update commit (secretaryBook)                                                                     |
| **Close**                       | ADR-0020: decisions, deviations, pin history                                                                                          | —                                                                                                                                                                                        |

Slices 3 and 4 are deliberately separate: the read-only queue is
independently gateable and keeps each pin-update commit small. If the
owner prefers fewer PRs they merge cleanly into one slice.

## 7. Open questions for the owner (blocking Slice 2+)

1. **Walk-in booking in or out?** The ADR-0019 9b stub lists it
   ("clinic-day lists, check-in flow, walk-in booking"); the kickoff
   scope sentence names only confirm/check-in/start/complete.
2. **`myAppointments.cancellable` (patient app, F-07 remediation
   proper): ride Slice 2 or stay a separate hygiene slice?**
3. **Doctor encounter composers on mobile** (visit notes,
   prescriptions — ADR-0019 Slice 5 called them "the doctor composers
   are 9b"): assumed OUT of queue-view scope unless ruled in.
4. **MM-QA-003 F-04** (WSL gate tasks spawn the Windows pnpm shim via
   interop) is flagged "pre-Phase-9b hygiene" in the audit. Not
   touched by this slice; owner decision whether the `corepack enable`
   fix lands as its own commit before Slice 2.

## 8. Owner decisions — 2026-07-14 (Slice 1 review; answers §7)

1. **Walk-in booking: OUT of 9b** — deferred to its own future slice.
   The ADR-0019-stub vs kickoff divergence is resolved by deferring,
   not expanding; the deferral is to be recorded in closing ADR-0020.
   Former Slice 5 is dropped.
2. **`myAppointments.cancellable`: separate slice**, never bundled
   into Slice 2 — its own branch → PR → CI-green → merge, sequenced at
   implementer discretion after the queue slices.
3. **Doctor encounter composers: not built in 9b.** Before assuming
   out-of-scope, the existing phase-5/ADR-0010 clinical API is to be
   inventoried read-only (does a doctor-facing note/prescription
   composer surface already exist, thin-client- and pin-safe per
   ADR-0013?) and reported — no build. Anything needing new tRPC is
   out of 9b.
4. **F-04: fix immediately, before Slice 2**, as its own documented
   commit — not bundled into any slice.
5. **New decision (record in ADR-0020, do NOT build in 9b):** a
   "delay/bump late patient" queue capability (doctor chooses
   no-show / reschedule / delay) is confirmed as future scope after
   9b — it needs a new appointment state plus new API, both forbidden
   this phase. The existing no-show and reschedule stay in 9b; a new
   "delay" action does not.

**Approved order:** F-04 fix (own commit) → Slice 2 (`allowedActions`)
→ Slice 3 (read-only queue + pin commit) → Slice 4 (actions + pin
commit) → `cancellable` slice (separate) → closing ADR-0020.
