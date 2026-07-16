# ADR-0029 — Phase 10 Slice 7: Supabase data migration ruled a no-op

## Status

Accepted. Phase 10 Slice 7 per MM-DES-003 §7 (ruled plan, PR #50).
Numbering per the §3 next-free rule (indicative 0030; Slice 4 remains
parked). Docs-only — this ADR is the slice's entire deliverable.

## Context

MM-PLAN-001 §5 Phase 10 lists: "Data migration script from old Supabase
DB (patients, providers, facilities, appointments) **if any production
data exists at cutover**." The kickoff constraint was explicit: ask the
owner whether production data exists — never assume.

## Decision

**Owner ruling D6 (2026-07-16, MM-DES-003 §8.1): no production data
exists in the old Supabase database.** The old system is the first
version and everything in it is test data.

Therefore, per the plan's own conditional wording and the ruled design:

1. **No migration script is built — deliberately.** A one-shot importer
   for data that does not exist is dead tooling: it would never run,
   never be tested against real inputs, and would sit in the repo
   implying a supported path that was never proven (the liability
   MM-DES-003 §7 named).
2. The old database's contents require no preservation action beyond
   the old codebase archive itself (Slice 8, HG-4 — the repository is
   archived read-only; its embedded test data goes with it).
3. If this ruling is ever discovered to be wrong before cutover, the
   slice reopens as its own standalone slice with its own ADR
   (slice-discipline rule, ADR-0010 precedent) — the identity-continuity
   rules of convention #7 (normalized-phone profile keying) remain the
   binding import semantics recorded for that contingency.

## Consequences

- Phase 10's migration line item is satisfied by a recorded ruling, not
  by code; the launch checklist (Slice 8) can mark it dispositioned.
- Nothing to maintain, nothing to drill; cutover has one less moving
  part.
