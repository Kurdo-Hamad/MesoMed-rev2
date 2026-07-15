# ADR-0006 — Phase 4: Scheduling + Booking

**Status:** Accepted
**Phase:** 4 (MM-PLAN-001 §5) — scheduling module (locations,
doctor-locations, secretary assignments, weekly schedules, breaks, blocked
slots, slot generation from the ported domain engine) and booking module
(appointment aggregate, ported state machine, guest/walk-in booking, full
role-gated lifecycle, double-booking invariant, booking.\* v1 events).
**Builds on:** ADR-0003 (kernel/outbox), ADR-0004 (identity, guest patient
profiles), ADR-0005 (directory doctor profiles; cross-module plain-uuid
reference precedent).

## Decisions

### 1. Ported domain code is used verbatim; modules stay thin

`packages/domain/scheduling` (`slots.ts`, `availability-week.ts`) and
`packages/domain/booking` (`transitions.ts`) — salvaged with their tests in
Phase 1.5 — are the only slot/transition logic. The scheduling module
persists their inputs (wall-clock weekly schedules + breaks in the
location's IANA timezone, default `Asia/Baghdad`; blocked ranges and
appointments as UTC `timestamptz`); the booking module expands and
validates through them. New subpath exports `@mesomed/domain/scheduling`
and `@mesomed/domain/booking` were added; no domain logic was modified.

### 2. The bookable aggregate is `doctor_locations`

A doctor practising at a practice location is the unit schedules,
secretary assignments, blocked slots and appointments all hang off.
Cross-module references (`doctorProfileId` → directory,
`secretaryUserId`/`createdBy` → identity, `patientProfileId` → identity)
are plain ids without FK constraints, per the `providers.identityProfileId`
precedent (ADR-0005); existence is validated through published query
functions at write time.

### 3. Double-booking invariant: in-tx check + partial unique index (§3.4)

`bookAppointment`/`rescheduleAppointment` re-derive the requested slot from
the schedule inside the command transaction (grid match, break/blocked
subtraction, overlap check against active appointments), then insert under
`appointments_active_slot_unique` — a partial unique index on
`(doctor_location_id, starts_at) WHERE status IN (booked, confirmed,
checked_in, in_progress)` ported from the old schema. Concurrency is
arbitrated solely by the index: the gate test proves N parallel bookings
for one slot yield exactly one success, every loser receiving the typed
`SLOT_UNAVAILABLE` (→ 409) with zero residue (profile + event roll back
with the appointment). Residual risk accepted: two bookings written under
_different_ schedule grids (schedule changed between them) can overlap
without equal starts; the index cannot catch that, the in-tx overlap check
catches it in all serialized cases, and a schedule change never moves
existing appointments (see #6).

### 4. Booking calls identity's profile write through a composition seam

MM-DEC rev02 §1/§9: guest and walk-in bookings find-or-create the
phone-keyed patient profile in the same transaction — eventual consistency
via events would leave the appointment without a `patientProfileId`. The
eslint boundaries rule (module → module value imports banned) is honored by
injecting identity's `createGuestPatientProfile` into
`createBookingRouter({ createGuestPatientProfile })` at the tRPC
composition seam (`src/trpc/router.ts`), typed in booking via a type-only
import. The write is identity's code running on booking's transaction —
module import graphs stay clean without weakening the §3.1 rule for
everyone else.

### 5. Two-layer authorization with named actor bindings (§3.6)

Layer a: kernel `roleProcedure` per procedure. Layer b: every lifecycle
command resolves the session to an actor binding — `patient_owner`
(identity published `getPatientProfileIdForUser`), `owning_doctor`
(directory published `getDoctorProfileIdForUser`, composing identity's
`getProviderProfileIdForUser`), `assigned_secretary` (scheduling published
`isSecretaryAssigned`), `admin` — against an explicit per-command allow
list documented in the booking router. The authz suite proves layer-a
denial per procedure/role AND layer-b denials (unassigned secretary,
non-owning doctor, foreign patient, patient with no claimed profile), and
two meta-tests introspect both routers so a new mutation cannot ship
without matrix coverage (HANDOFF-001 #14).

### 6. Blocking/schedule changes never mutate appointments

`setWeeklySchedule` wholesale-replaces schedule rows (input is the full
truth, same determinism as Phase 3 media/sections); `blockSlot` subtracts
future availability. Neither touches existing appointments — moving or
cancelling them is an explicit human decision through the lifecycle
commands, each with its own event. Availability queries therefore reflect
schedule truth immediately while booked slots stay booked.

### 7. Events: six contracts, snapshots, silent internal transitions (§3.3)

`booking.booked/confirmed/rescheduled/cancelled/completed/no_show.v1`
carry a denormalized appointment snapshot (ids, doctor profile, instants,
status, channel) so Phase 5 (clinical encounter on `completed`) and Phase 7
(communication) never join booking tables. `rescheduled` adds
`previousStartsAt/previousEndsAt`; `cancelled` adds `reason`. `checked_in`
and `in_progress` emit nothing — they are operational states with no
integration consumer; adding events later is additive.

### 8. Guest cancellation is deferred to clinic-side actors

Guests have no session, so `cancel`/`reschedule` require patient
(claimed profile), secretary, doctor or admin. A guest changes plans by
phoning the clinic (secretary acts) — a guest self-service
cancellation link (signed token) is deferred until a phase needs it.

## Gate verification

- Concurrency: 8 parallel `guestBook` calls for one slot → exactly one
  200, seven typed 409 `SLOT_UNAVAILABLE`, one active row, one
  `booking.booked.v1`; parallel reschedules onto one slot → one winner.
- Full lifecycle per role: guest books → secretary confirms/checks in →
  doctor starts/completes; secretary walk-in (find-or-create, actor
  recorded); no-show; patient cancel (slot reopens + rebookable);
  patient reschedule (status preserved, previous instants in the event).
- Invariants: off-grid start, past start, blocked slot, taken slot,
  illegal transitions, reschedule-after-complete, break-outside-window,
  inverted ranges — all typed errors; atomic rollback proven (no profile
  residue on a failed booking).
- Suite: 24 files / 240 tests green; workspace build, typecheck, lint,
  format green.

## Amendment — 2026-07-15 (Phase 9c delay/late-patient; MM-DES-002, ADR-0024)

Recorded per the dated-amendment pattern (ADR-0009 precedent). Owner
rulings D1–D7/D4a of 2026-07-14 (MM-DES-002 §11, FINAL) extend this
ADR's appointment machine:

- **Machine extension — 8 statuses.** `delayed` is added with edges
  `confirmed`/`checked_in` → `delayed`; `delayed` →
  `checked_in`/`no_show`/`cancelled`; `delayed → confirmed` reserved for
  the reschedule reset. The `checked_in ↔ delayed` cycle is deliberate
  and pinned in unit tests. `delayed` joins the active-status set: the
  `appointments_active_slot_unique` partial index and the status CHECK
  were recreated with `delayed` in migration `0009` — a delay never
  frees the slot and never changes `starts_at`/`ends_at` (D1).
- **Reschedule-status exception.** "Patient reschedule (status
  preserved)" above gains its one exception: reschedule from `delayed`
  resets status to `confirmed` (D4). The `booking.rescheduled.v1`
  payload carries `confirmed`, never `delayed`.
- **Authorization narrowing (D4a).** Reschedule remains ANY_PARTY from
  `booked`/`confirmed`, but from `delayed` it is CLINIC_SIDE only
  (secretary/doctor/admin), enforced server-side. Delay and recall are
  CLINIC_SIDE only; patients get neither action (D2/D3).
- **Event set.** `booking.delayed.v1` joins the set (now 7 events,
  pinned in `booking-events.test.ts`) with the standard post-transition
  snapshot; no subscriber this phase (EV ruling — the future consumer is
  the notification system, MM-DES-002 §12). Recall emits no event.
