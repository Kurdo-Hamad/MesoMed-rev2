# MM-DES-002 — Phase 9c Slice 1: Delay/Bump Late Patient — Design Note

|             |                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**    | 2026-07-14                                                                                                                                                                                                  |
| **Status**  | Design note (Slice 1 deliverable — no code). **Owner rulings recorded 2026-07-14** — all §11 decisions (D1–D7 including D4a and D6, plus the events question) are RULED FINAL.                              |
| **Scope**   | Phase 9c: the "delay/bump late patient" capability deferred by owner decision in MM-DES-001 §8 / ADR-0020. New procedures, a new appointment state, new events and enum widening are authorized this phase. |
| **Sources** | ADR-0006 (state machine, double-booking invariant, events, two-layer authz), ADR-0013 (pin discipline), ADR-0020 (deferral + release-cut note), code cited by file:line at `main` @ `fd701ed`.              |

**Product intent (owner's words, binding):** a patient is late; the doctor
must not sit idle. The doctor or secretary can **delay** the late patient —
keep their booking, push them down the queue, see the next patient now.
When the late patient arrives they are re-slotted. On a late patient the
doctor always chooses explicitly between **no-show, delay, or reschedule**;
the first two exist, delay is new. **Delay must never silently move other
appointments.**

Hard constraints restated from the kickoff: state-machine truth lives only
in `packages/domain/booking` and `allowedActions` must offer `delay` from
the same single source the mutations enforce (the 9b no-drift property,
with tests); no client-side status rules (F-07); delay never mutates other
appointments and never violates the double-booking invariant; en/ar/ckb
keys for all new copy with the F-10 guardrail green; pin changes only via
`UPDATE_FROZEN_SURFACE=1` in their own commits with byte-identical priors
verified.

## 1. Representation — RULED (2026-07-14): a new `delayed` status

> **D1 — RULED FINAL (2026-07-14):** the owner adopts recommendation (A)
> — a real `delayed` status, with exactly the edges listed below:
> `confirmed`/`checked_in` → `delayed`; `delayed` →
> `checked_in`/`no_show`/`cancelled`; and `delayed` → `confirmed`
> reserved for the reschedule status reset (§4.4). Delay never touches
> `starts_at`.

**Recommendation (A): add `delayed` to `APPOINTMENT_STATUSES` and the
transition map.** New edges in
`packages/domain/booking/transitions.ts:17-25`:

```
confirmed  → delayed      (action: delay)
checked_in → delayed      (action: delay — re-delay after recall, or patient stepped out)
delayed    → checked_in   (action: recall — the patient arrived)
delayed    → no_show      (action: noShow — never arrived, manual)
delayed    → cancelled    (action: cancel)
delayed    → confirmed    (no action — reschedule's status reset only, §4.4)
```

Not added: `booked → delayed` (parity with `noShow`, which is also not
offered from `booked` — the three-way choice happens on a confirmed
appointment); `delayed → delayed` (a self-loop is a no-op: there are no
persisted queue positions to re-bump, §3); `delayed → in_progress`
(everyone else must be `checked_in` before `start`; a delayed patient is
recalled first — same physical-presence rule).

**Analysis against the locked invariants:**

- **`starts_at` is never touched by delay or recall.** The appointment
  keeps its booked slot instants; "pushed down the queue" is a state, not
  a time change (§3). The partial unique index
  `appointments_active_slot_unique` on `(doctor_location_id, starts_at)`
  (`packages/db/src/schema/booking.ts:54-56`) is therefore untouchable by
  these commands **by construction** — no concurrency test against the
  index is owed for delay/recall (the kickoff requires one only if the
  design touches `starts_at`; it doesn't). The only path that moves a
  delayed appointment's time is the existing `reschedule`, which is
  already conflict-checked and concurrency-proven (ADR-0006 §3, gate
  test "parallel reschedules onto one slot → one winner").
- **`delayed` joins `ACTIVE_APPOINTMENT_STATUSES`**
  (`transitions.ts:28-33`) and the index's `WHERE` list. A delayed
  appointment is a live commitment and must never be slot-transparent to
  conflict logic. Practical impact is nil today (its `starts_at` is in
  the past by the time anyone delays, and past slots are not bookable),
  but excluding it would silently lapse double-booking protection if any
  future flow ever gave a delayed appointment a future instant.
  Migration `0009`: drop/recreate the partial index with `delayed` in the
  `WHERE` list, and drop/recreate `appointments_status_check`
  (`schema/booking.ts:65-68`).
- **clinicDay ordering is unchanged** — see §3.

**Alternative (B, rejected): keep the existing status and add a
`deferred_at` column** (delay = `confirmed` + timestamp). No enum widens
anywhere (no pin churn, old binaries render nothing new), no migration of
the index. Rejected because it forks the state model: appointment state
becomes two-dimensional (`status` × `deferred_at`), so
`allowedAppointmentActions(status, actors)`
(`packages/domain/booking/allowed-actions.ts:55-64`) — the 9b
single-source — can no longer derive affordances from status alone;
delay/recall guards leak into command code outside the transition map,
which is exactly what the "state-machine truth lives ONLY in
packages/domain/booking" constraint forbids; and every event snapshot
would report a delayed patient as `confirmed`, which is misleading to
subscribers. The state is real; it belongs in the machine.

## 2. Action model — `delay` and `recall`, and the edge refactor they force

New members of `APPOINTMENT_ACTIONS`
(`packages/contracts/src/booking.ts:131-139`): **`delay`** and
**`recall`**. Both return `transitionResultSchema`; both take
`appointmentIdInputSchema` (no reason field — `cancel` keeps that
distinction).

**Discovered constraint: the current affordance derivation cannot
represent `recall`.** `allowedAppointmentActions` derives "is this action
available in this status" purely from the action's _target_
(`canTransition(status, ACTION_TARGET_STATUS[action])`,
`allowed-actions.ts:59-63`). `recall` and `checkIn` share the target
`checked_in`, so under pure target-derivation `checkIn` (FRONT_DESK)
would be offered on `delayed` rows and `recall` on `confirmed` rows —
and worse, the _mutations_ would accept them
(`transition-appointment.ts:53-60` asserts only the map edge), breaking
9b's affordance-⊆-authz property in reverse (an unoffered action that
succeeds).

**Recommendation: replace the two parallel records with one edge table in
the domain package** — still pure, still the single source:

```ts
// packages/domain/booking/allowed-actions.ts
export const APPOINTMENT_ACTION_EDGES: Record<
  AppointmentAction,
  {
    sources: readonly AppointmentStatus[];
    target: AppointmentStatus;
    actors: readonly AppointmentActorKind[];
  }
> = {
  confirm: { sources: ["booked"], target: "confirmed", actors: CLINIC_SIDE },
  checkIn: { sources: ["confirmed"], target: "checked_in", actors: FRONT_DESK },
  start: { sources: ["checked_in"], target: "in_progress", actors: DOCTOR_ONLY },
  complete: { sources: ["in_progress"], target: "completed", actors: DOCTOR_ONLY },
  noShow: {
    sources: ["confirmed", "checked_in", "delayed"],
    target: "no_show",
    actors: CLINIC_SIDE,
  },
  cancel: { sources: ["booked", "confirmed", "delayed"], target: "cancelled", actors: ANY_PARTY },
  delay: { sources: ["confirmed", "checked_in"], target: "delayed", actors: CLINIC_SIDE },
  recall: { sources: ["delayed"], target: "checked_in", actors: CLINIC_SIDE },
};
```

`allowedAppointmentActions` filters on `status ∈ sources` (with
`canTransition(status, target)` retained as a consistency assertion — a
unit test proves every edge's source/target pair is a legal map
transition, so the two structures cannot drift). `transitionAppointment`
takes the **action name** instead of `{to, allowedActors}` and enforces
sources, target and actors from the **same record** the affordance reads
— the no-drift property strengthens: the router
(`apps/api/src/modules/booking/router.ts:103-180`) no longer even picks
allow-lists per call. Every existing edge above is byte-for-byte today's
behavior (sources are exactly the statuses whose map row contains the
target), so the refactor changes no existing semantics.

**Alternative (rejected): make `recall` an alias of `checkIn`** (widen
`checkIn`'s legality to `delayed`, no new action). Fewer moving parts,
but `checkIn` is FRONT_DESK — a solo doctor (a real `myWorkplaces`
shape: `owning_doctor` with no secretary) could never recall from their
phone, and widening `checkIn` to CLINIC_SIDE to compensate would change
an existing authz surface and sprout doctor check-in buttons on every
confirmed row. A distinctly-named action with its own allow-list is the
honest model.

## 3. Queue order & re-entry — no persisted positions, no reordering writes

> **D3 — RULED FINAL (2026-07-14):** `recall → checked_in`, CLINIC_SIDE,
> no persisted queue positions. The recalled patient remains visible in
> the queue; the doctor freely chooses the next patient. Grouping
> delayed rows at the bottom of the list is presentation-only.

**Recommendation: there is no queue-position column and no reordering.**
`delay`/`recall` write exactly one row (the delayed appointment's
`status`/`status_changed_at`) — the "never silently moves other
appointments" constraint is satisfied **by construction**, provable with
a test asserting sibling rows are byte-identical across a delay.

- `booking.clinicDay` stays ordered by `starts_at`
  (`queries/clinic-day.ts:80`) — it is a schedule-shaped day view that
  already interleaves completed/cancelled rows chronologically; "queue
  position" has always been a presentation of it.
- "Push them down" is realized by state, not order: the mobile queue
  groups `delayed` rows into a separate section below the active list.
  Grouping-by-status is **presentation** of server truth (layout), not a
  client-side status _rule_ (F-07 forbids clients deciding what actions a
  status permits; it does not forbid rendering rows in sections).
- **Re-entry is `recall` → `checked_in`.** The patient arrived; they are
  back in the waiting set. There is no "pick a spot" machinery: service
  order is decided by which `checked_in` patient the doctor `start`s next
  — "next-after-current" emerges naturally, exactly how the doctor's
  three-way choice was framed. A patient who instead wants another day is
  `reschedule`d (§4.4) — a real slot pick that already exists.

**Alternatives (rejected):** (i) server reorders delayed rows to the
bottom of `clinicDay` — bakes one screen's presentation into a query that
web also consumes chronologically, and old clients would show a silently
re-ordered day; (ii) a server-computed `queuePosition` field — implies
positions must be maintained when _other_ appointments change, i.e. the
forbidden reordering writes, and adds pinned surface for no consumer;
(iii) an exposed `delayedAt` output field — not needed by any approved
screen; it is additive later with zero pin churn (the `cancellable`
precedent, ADR-0020) if a screen wants "delayed 40 min ago".

## 4. Edge cases

1. **Delayed patient never arrives → manual `no_show` only — D6 RULED
   FINAL (2026-07-14): no end-of-day auto-sweep. Still-delayed
   appointments are never auto-transitioned; sign-off is manual only —
   doctor or secretary resolves each delayed patient at their discretion
   via the existing allowed edges (`no_show` / `cancelled` / recall to
   `checked_in`).** The edge
   `delayed → no_show` is CLINIC_SIDE, same as today. **No end-of-day
   sweep:** every lifecycle change today is an explicit human decision
   with its own event (ADR-0006 §6); a sweep cron would be the first
   machine-driven status mutation in the system, with timezone/day-close
   guesswork, for no consumer. A leftover `delayed` row is inert (its
   `starts_at` is past; it blocks nothing) and the clinic resolves it
   next morning from the previous day's view (`prevDay` navigation
   exists on both clinic screens).
2. **Multiple delays of the same patient:** the cycle is
   `checked_in → delayed → checked_in` (recall, then delay again if the
   doctor is busy or the patient steps out). No `delayed → delayed`
   self-loop — with no persisted positions a re-bump changes nothing.
   Note for the domain tests: this introduces the transition map's first
   cycle; nothing in the codebase assumes acyclicity
   (`status_changed_at` just updates), but `transitions.test.ts` should
   pin the cycle deliberately. Each delay emits a fresh
   `booking.delayed.v1` (distinct `eventId`, so notification occurrence
   keys stay distinct per ADR-0011 F-1 if a subscriber ever plans from
   it).
3. **Delay near closing time: no special rule.** Delay never consults the
   schedule (no `starts_at` change, no slot resolution). A patient
   delayed at 19:55 either gets recalled before the doctor leaves or is
   no-showed / rescheduled / cancelled — all four resolutions remain
   offered on the row.
4. **Reschedule from `delayed` — RULED FINAL (2026-07-14, D4): allowed,
   status resets to `confirmed`, as recommended.** Reschedule is one of
   the owner's three explicit options and
   must remain available _after_ delay was chosen first ("can't stay —
   book me Thursday"). `RESCHEDULABLE_STATUSES` (`transitions.ts:36-39`)
   gains `delayed`, and the status-preservation rule (ADR-0006 §7,
   `reschedule-appointment.ts:76-88`) gains one exception via a pure
   domain helper: `rescheduleTargetStatus(status)` = `confirmed` for
   `delayed`, identity otherwise (asserted through the
   `delayed → confirmed` map edge, so the machine stays total). A
   rescheduled-from-delayed appointment is a normal confirmed appointment
   at a future slot — and `booking.rescheduled.v1` then never carries
   `"delayed"` (load-bearing for §5). Recorded as a dated amendment note
   in ADR-0006 per the ADR-0009 pattern. **Alternative (rejected):**
   forbid reschedule from `delayed` (force cancel + rebook) — loses the
   atomic conflict-checked move, clutters history with a cancellation
   that isn't one, and silently removes one of the three owner-named
   options after a delay. **D4a — RULED FINAL (2026-07-14): patient
   self-reschedule of a delayed appointment is NOT allowed in 9c.**
   Reschedule from `delayed` is CLINIC_SIDE only
   (secretary/doctor/admin), consistent with D2. This **narrows the
   existing ANY_PARTY reschedule authorization** for the delayed-state
   case — Slice 2 must enforce this server-side, not doc-only, with the
   corresponding authz-denial integration test (§9). Owner intent
   recorded for the deferred backlog (§12): patients will later be able
   to select an available open slot themselves, subject to secretary
   approval — part of the already-recorded patient-request-with-approval
   workflow, out of 9c scope.
5. **Cancel from `delayed`: allowed, ANY_PARTY** — the patient who never
   arrived can bail from home. `myAppointments.cancellable` turns true
   automatically because it is computed from the same domain function
   (`my-appointments` + `allowed-actions.ts`), no extra code.
6. **Patient-side visibility:** `myAppointments` items will carry
   `status: "delayed"`. New binaries render the new catalog key; old
   binaries would show a raw missing-key label. See §8 for why this is
   currently a non-issue (no shipped binaries) and where the knob lives.

## 5. Events

> **RULED FINAL (2026-07-14):** emit `booking.delayed.v1` on delay. No
> subscriber this phase. Owner intent recorded: the future consumer is a
> notification system (push, rendered in the user's selected app
> language) — future slices, out of 9c scope (§12).

- **New contract: `booking.delayed.v1`** —
  `defineEvent("booking", "delayed", 1, appointmentSnapshotSchema)`
  (`packages/contracts/src/events/booking.ts:28-39`), emitted
  transactionally by adding `delayed` to the `TRANSITION_EVENTS` map
  (`transition-appointment.ts:27-32`); payload is the standard
  post-transition snapshot (status `"delayed"`), per the phase-4 pattern.
  Plausible near-term consumer: a communication "you've been deferred —
  come to the clinic" notice. **Not built this phase** — the event
  existing from day one is exactly what lets communication subscribe
  later without touching booking (§3.3).
- **No re-entry event.** `recall → checked_in` emits nothing — the
  precedent is explicit: `checked_in`/`in_progress` are operational
  states with no integration consumer, "events are contracts, not a
  changelog" (ADR-0006 §7). Adding `booking.recalled.v1` later is
  additive. **Alternative (rejected):** emit it now "for completeness" —
  event contracts are forever (§3.3); we don't mint permanent contracts
  with zero consumers.
- **Enum widening in the shared snapshot schema.** `APPOINTMENT_STATUSES`
  in `events/booking.ts:12-20` gains `delayed`, which formally alters all
  six existing v1 payload schemas. This is runtime-additive — **no
  pre-existing event can ever carry `"delayed"`**: transition snapshots
  are post-transition (`transition-appointment.ts:75`), so
  cancelled/no_show from delayed carry their terminal status; rescheduled
  from delayed carries `"confirmed"` under the §4.4 reset; `delayed`
  itself appears only in the new event. An old-schema consumer therefore
  never receives an unparseable payload, and no new event versions are
  needed. An integration test asserts the rescheduled-from-delayed
  payload carries `"confirmed"`, pinning the argument.
- **Event-set pin:** booking predates the per-module event pin pattern
  (`packages/contracts/test/{billing,clinical,identity}-events.test.ts`
  exist; booking has none). The slice that adds the event also adds
  `booking-events.test.ts` pinning the 7-event set — that file _is_ the
  DoD contract test for the new event, not bundled scope.
- **Existing subscribers unaffected:** communication plans on
  booked/rescheduled/cancelled
  (`communication/events/on-booking-events.ts:25-38`), billing on
  completed/cancelled/no_show, clinical on completed — all still receive
  exactly the statuses they parse today.

## 6. Authorization

> **D2 — RULED FINAL (2026-07-14):** delay and recall are CLINIC_SIDE
> only (secretary/doctor/admin). Patients get neither action.

| Action   | Layer a (`roleProcedure`) | Layer b (edge `actors`) |
| -------- | ------------------------- | ----------------------- |
| `delay`  | secretary, doctor, admin  | `CLINIC_SIDE`           |
| `recall` | secretary, doctor, admin  | `CLINIC_SIDE`           |

**Justification for CLINIC_SIDE on both:** `delay` is the third prong of
a choice whose other two prongs (`noShow` CLINIC_SIDE, `reschedule`
ANY_PARTY) the doctor drives — and the owner's words are "the doctor (or
secretary)". `recall` must include the owning doctor because solo-doctor
workplaces are a real shape and recall is precisely the doctor's "I'll
see them now" affordance mid-session. **`patient_owner` gets neither**:
patients must not self-delay to dodge a no-show or game the queue; the
patient's self-service verbs on a delayed appointment remain `cancel`
(and nothing else — **D4a RULED FINAL (2026-07-14):** `reschedule` from
`delayed` is CLINIC_SIDE only, §4.4). Admin rides every allow-list as
today.

The authz suite's introspective meta-tests (ADR-0006 §5) force MATRIX and
mutation-list coverage for both new mutations
(`apps/api/test/booking/authz.test.ts`), including a true layer-b denial
(the `outsiderSecretary` fixture from 9b).

## 7. Surfaces

- **Mobile clinic queue (primary, this phase):** delay/recall buttons
  driven purely by server `allowedActions` (the mutations map in
  `apps/mobile/app/clinic.tsx:173` gains two entries), `status_delayed`
  chip, delayed rows grouped below active rows (§3). Patient
  appointments screen needs only the new status catalog key (its status
  label is already a dynamic template, `dashboard/appointments.tsx:97`).
- **Known-action render filter (required, lands with the enum):** mobile
  renders `allowedActions.filter(isKnownAction)` before mapping to
  buttons. Today's code would _crash on tap_ for an unknown action
  (`mutations[action].mutate` on an undefined lookup,
  `clinic.tsx:173-175`) — and widening `AppointmentAction` breaks mobile
  typecheck at that same lookup, so the filter is the compile-required
  adjacent fix in the server slice, and permanent forward-compat
  hardening for every future enum widening. It encodes zero
  state-machine knowledge (renders a subset of server truth), so F-07 is
  intact.
- **Web clinic page: RECOMMENDED deferred to its own named slice.** The
  page's hardcoded `DOCTOR_ACTIONS`/`SECRETARY_ACTIONS` maps
  (`apps/web/app/[locale]/dashboard/clinic/page.tsx:87-98`) are the F-07
  anti-pattern ADR-0020 already earmarked for deletion; extending them
  with delay/recall entrenches exactly what's slated to die. This phase
  web gets **catalog keys only**: a delayed row renders its status chip
  correctly and offers no actions (the `actions[status] ?? []` guard at
  `page.tsx:219` makes missing statuses safe — verified, no crash).
  Clinic staff use mobile for delay/recall until the web migration slice
  lands. **Alternative (owner may rule in):** proposed Slice 4 migrates
  web onto `allowedActions` (delete both maps, render server truth, wire
  all eight mutations) — it is the ADR-0020 "natural follow-up when a
  slice next touches that page", independently gateable.

> **D5 — RULED FINAL (2026-07-14), overriding the recommendation
> above:** web + mobile are built TOGETHER. Web is REQUIRED, not
> optional — it gets the full delay/recall UI this phase (in Slice 3,
> per the D7 ruling in §10), not catalog keys only. Rationale: doctors
> work primarily on web/PC; patients on mobile; a simultaneous ship
> enables a single marketing launch and a web-first patient acquisition
> funnel.

- **i18n keys (en/ar/ckb, all in the server slice — see §8 for why):**
  `status_delayed` in the mobile clinic and patient-appointments
  namespaces and `web.dashboard`; `action_delay`/`action_recall` in the
  mobile clinic namespace plus `web.dashboard` (required — the D5 ruling
  puts the full web UI in Slice 3). Machine translations flagged for the existing deferred
  native-speaker human gate — not self-certified.

## 8. Pin impact — exact ledger (ADR-0013 / ADR-0020 release-cut note)

**`frozen-schema-surface.json` — release-cut `UPDATE_FROZEN_SURFACE=1`
regeneration required, twice, each in its own commit:**

1. **Server slice (status + actions enum widening).** `leafMismatch`
   compares `enum` arrays byte-exact
   (`apps/api/test/router-schema-surface.test.ts:127-136`), so widening
   `APPOINTMENT_STATUSES` changes the frozen bytes of **nine** pinned
   entries: `booking.clinicDay` (items.status — plus items.allowedActions
   from the `APPOINTMENT_ACTIONS` widening), `booking.myAppointments`
   (items.status), `booking.guestBook` (result status), and the six
   transition results `booking.cancel/checkIn/complete/confirm/noShow/start`.
   Verification obligation: the regen diff touches **only** those enum
   arrays; all other entries byte-identical (9b practice).
2. **Mobile slice.** `MOBILE_CONSUMED` (+`booking.delay`, +`booking.recall`, `router-schema-surface.test.ts:42-74`) with
   regeneration adding the two new entries; every prior entry
   byte-identical. Regenerated JSON `prettier --write`'d before commit
   (9b Slice-3 gotcha).

**Explicitly NOT touched:**

- `frozen-router-surface.json` (path+kind pin): new procedures are
  additive by that pin's design (it detects disappearance/kind-change
  only). Regen runs must be scoped to `router-schema-surface.test.ts` so
  the path pin is not incidentally rewritten.
- No additive-tolerant output fields are planned (`delayedAt` deferred,
  §3) — if later wanted, it rides the pin-free additive path proven by
  `cancellable`.

**Coupled non-pin surfaces (same slice as the enum widening, or CI goes
red):** the mobile F-10 consumed-key guardrail expands
`status_${...}`/`action_${...}` templates against the **contracts**
enums, so the en/ar/ckb keys must land in the very slice that widens the
enums; the mobile known-action filter (§7) is compile-required in that
slice too. Also updated there: migration `0009` (check constraint +
partial index), domain matrix tests (8 statuses × 4 actors — the
`Record` types force exhaustiveness at compile time), authz
MATRIX/mutation lists, `booking-events.test.ts`.

**`mobile.compat` `minSupportedVersion`:** the config knob (ADR-0013 §2)
is the owner's lever if stale binaries ever pre-date this enum widening.
Today it is moot — **no production/store binary exists** (the 9a
device-verification human gate is still pending), so no installed client
can hit the unknown-status/unknown-action path. Decision belongs to the
release cut, not this phase.

## 9. Testing DoD mapping (per slice, convention #12)

- **Domain unit:** transition matrix extended to 8 statuses (legal +
  illegal edges, the deliberate `checked_in↔delayed` cycle pinned);
  `APPOINTMENT_ACTION_EDGES` consistency proof (every edge is a legal map
  transition — the no-drift meta-property); `allowedAppointmentActions`
  matrix 8 statuses × 4 actor kinds; `rescheduleTargetStatus`.
- **Integration (client-driven, real sessions — 9b fixture):** per new
  flow happy path (secretary delays / doctor delays; recall; delay →
  recall → delay again; delayed → no_show; delayed → cancel by patient;
  reschedule-from-delayed by a clinic-side actor lands `confirmed` at
  the new slot; patient reschedule-from-delayed is denied — D4a); layer-b
  denial per new mutation (unassigned secretary, typed `FORBIDDEN`, row
  untouched); invariant violations (delay from
  booked/in_progress/terminal, recall from non-delayed → typed
  `INVALID_STATUS_TRANSITION`); **immutability proof** — a delay leaves
  every sibling appointment row byte-identical and never changes the
  delayed row's `starts_at`/`ends_at`; affordance-⊆-authz for
  delay/recall (unoffered → rejected).
- **Events:** `booking.delayed.v1` emission asserted transactionally;
  rescheduled-from-delayed payload carries `"confirmed"` (§5); event-set
  pin.
- **Contracts/pins:** schema-surface regen diffs reviewed per §8; F-10
  i18n guardrail green.

## 10. Slice boundaries (each independently gateable)

> **D7 — RULED FINAL (2026-07-14): revised slice plan.** The list below
> is the ruled plan. The originally drafted "optional web Slice 4" is
> **superseded** — web work moves into Slice 3 as required (per D5), and
> Slice 4 becomes the ADR-0021 closeout.

- **Slice 1 (this document):** design note, own PR, then STOP for owner
  approval. ✅ No code.
- **Slice 2 — server vertical:** domain (`delayed` status, edges model,
  `RESCHEDULABLE_STATUSES`+reset helper, unit matrices) → contracts
  (status enums, `APPOINTMENT_ACTIONS` +2, `booking.delayed.v1`,
  `booking-events.test.ts`) → migration `0009` → API (`booking.delay`,
  `booking.recall`, `transitionAppointment` edge enforcement,
  reschedule-from-delayed incl. the D4a clinic-side-only server
  enforcement; `clinicDay`/`cancellable` affordances flow
  automatically from the domain function) → i18n catalog keys ×3 →
  mobile known-action filter (compile-required, §7) → integration tests
  per §9. Final commit in the PR: schema-pin regeneration #1
  (`UPDATE_FROZEN_SURFACE=1`, own commit, nine-entry enum-only diff
  verified).
- **Slice 3 — mobile consumption and full web delay/recall UI,
  together (per D5/D7 rulings):** mobile delay/recall buttons + delayed
  section on `/clinic`, patient-appointments delayed rendering, the full
  web delay/recall UI on the dashboard clinic page, `MOBILE_CONSUMED` +2
  with pin regeneration #2 (own commit), client-driven per-flow tests
  incl. a layer-b denial through the real session harness.
- **Slice 4 — close: ADR-0021** (decisions, deviations, pin ledger,
  ADR-0006 dated amendment note for the reschedule-status exception +
  machine extension), then STOP. _(The drafted "optional web Slice 4" is
  superseded — web work is required and lives in Slice 3.)_

## 11. Decisions — owner rulings of 2026-07-14 recorded as FINAL

| #   | Decision                      | Recommendation                                                                                                                                                                | Ruling (2026-07-14)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Representation                | New `delayed` status (§1 A), not a deferral field                                                                                                                             | **RULED** — real `delayed` status per recommendation. Edges as specified: `confirmed`/`checked_in` → `delayed`; `delayed` → `checked_in`/`no_show`/`cancelled`; `delayed → confirmed` reserved for the reschedule reset. Delay never touches `starts_at` (§1)                                                                                                                                                                                                            |
| D2  | Delay sources                 | `confirmed` and `checked_in` (parity with `noShow`; enables re-delay)                                                                                                         | **RULED** — sources `confirmed` + `checked_in`, fixed by the D1 edge set. The owner's D2 ruling additionally fixes actors: delay + recall are CLINIC_SIDE only (secretary/doctor/admin); patients get neither action (§6)                                                                                                                                                                                                                                                |
| D3  | Re-entry                      | `recall → checked_in`, CLINIC_SIDE; no queue positions, no re-entry event                                                                                                     | **RULED** — `recall → checked_in`, CLINIC_SIDE, no persisted queue positions. Recalled patient remains visible in the queue; the doctor freely chooses the next patient. Delayed rows grouped at the bottom of the list is presentation-only (§3)                                                                                                                                                                                                                        |
| D4  | Reschedule from `delayed`     | Allow, status resets to `confirmed` (ADR-0006 amendment note)                                                                                                                 | **RULED** — allowed, resets to `confirmed` (§4.4)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D4a | …and for `patient_owner` too? | Yes — reschedule is already ANY_PARTY from booked/confirmed; keeping the patient's existing verb on their own late appointment is consistent (they still cannot delay/recall) | **RULED, recommendation overridden** — patient self-reschedule of a delayed appointment is NOT allowed in 9c; reschedule from `delayed` is CLINIC_SIDE only (secretary/doctor/admin), consistent with D2. Narrows the existing ANY_PARTY reschedule authorization for the delayed-state case — Slice 2 must enforce this server-side, not doc-only. Deferred intent (§12): patients later select an available open slot themselves, subject to secretary approval (§4.4) |
| D5  | Web surface this phase        | Catalog keys only; full web migration as optional Slice 4                                                                                                                     | **RULED, recommendation overridden** — web + mobile built TOGETHER; web is REQUIRED, not optional (full delay/recall UI). Rationale: doctors work primarily on web/PC; patients on mobile; simultaneous ship enables a single marketing launch and a web-first patient acquisition funnel (§7)                                                                                                                                                                           |
| D6  | Never-arrives sweep           | Manual `no_show` only; no cron                                                                                                                                                | **RULED** — no end-of-day auto-sweep; still-delayed appointments are never auto-transitioned. Sign-off is manual only: doctor or secretary resolves each delayed patient at their discretion via the existing allowed edges (`no_show` / `cancelled` / recall to `checked_in`) (§4.1)                                                                                                                                                                                    |
| D7  | Slice boundaries              | §10 as proposed                                                                                                                                                               | **RULED, revised** — Slice 2 = server vertical (domain edges via `APPOINTMENT_ACTION_EDGES` refactor, contracts, migration 0009, API, enum widening, en/ar/ckb keys, frozen-surface regen #1); Slice 3 = mobile consumption and full web delay/recall UI, together (+regen #2); Slice 4 = ADR-0021 closeout. The drafted "optional web Slice 4" is superseded (§10)                                                                                                      |
| EV  | Events                        | Emit `booking.delayed.v1` on delay; no recall event; no subscriber this phase (§5)                                                                                            | **RULED** — emit `booking.delayed.v1` on delay. No subscriber this phase. Owner intent recorded: future consumer is a notification system (push, in the user's selected app language) — future slices, out of 9c scope (§5, §12)                                                                                                                                                                                                                                         |

## 12. Deferred / backlog — owner-required future work (out of 9c scope)

Recorded 2026-07-14 by owner ruling. These are **required future work**,
not optional ideas; neither belongs to any 9c slice.

1. **Notification system:** mobile push + a web bell-icon notification
   center. Notifications are both pushed AND persisted (readable later);
   rendered in the user's selected language. A shared persistence
   foundation likely precedes both platform slices. First planned
   consumer of `booking.delayed.v1` (§5).
2. **Patient-initiated delay/reschedule/cancel requests** with a
   secretary approval workflow. Owner intent recorded with the D4a
   ruling: patients will later be able to select an available open slot
   themselves, subject to secretary approval — that workflow is where
   patient-driven re-slotting of a delayed appointment lands (9c keeps
   reschedule-from-delayed CLINIC_SIDE only).
