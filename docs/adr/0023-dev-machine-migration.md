# ADR-0023 — Dev machine migration: old PC retired, environment rule made machine-agnostic

## Status

Accepted. Standalone docs slice (no code; not phase work — `main` was green
when this was cut).

## Context

Development moved to a new PC. The binding "Development environment" rule in
CLAUDE.md hard-coded the old machine's Windows checkout path
(`C:\Users\Lenovo\Documents\MesoMed.rev2`), which no longer exists — a stale
path in a binding rule invites sessions to ignore the rule as outdated.

## Decision

1. **Old PC formally retired.** `DESKTOP-285C6AB` (user `lenovo`) is no
   longer a development machine for this repository. Nothing unpushed
   remained on it — all branches and history are on `origin`.
2. **New PC is the sole authoritative machine.** `DESKTOP-H8SS4BE` (user
   `kurdo`), WSL clone at `~/mesomed`.
3. **CLAUDE.md environment rule reworded machine-agnostic.** The rule no
   longer names a machine or a Windows path: the WSL clone at `~/mesomed`
   is the only authoritative working copy; never build, test, or commit
   from any Windows-side (`/mnt/c`) checkout. The CRLF-corruption precedent
   stays as the reason, and the stop-and-surface instruction for sessions
   on a Windows path is unchanged. This wording survives future machine
   migrations without another edit.

Historical documents that name the old machine's paths (MM-QA-002,
MM-QA-003, ADR-0018) are records of what happened on that machine and are
deliberately left untouched.

## Consequences

- CLAUDE.md's environment rule cannot go stale on the next migration; only
  this ADR carries machine identities, as a point-in-time record.
- The serialized-test-run rule (`--concurrency=1`, embedded PG16 collisions)
  is unchanged and continues to apply on the new machine.
