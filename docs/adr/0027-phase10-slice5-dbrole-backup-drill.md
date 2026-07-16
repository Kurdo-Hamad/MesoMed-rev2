# ADR-0027 — Phase 10 Slice 5: least-privilege verification + backup/restore drill

## Status

Accepted. Phase 10 Slice 5 per MM-DES-003 §7 (ruled plan, PR #50).
**HG-3 (backup/restore drill execution) is OPEN, owner-only.**
Numbering note (MM-DES-003 §3 rule: "next free at merge time", ADR-0024
precedent): §3 indicatively mapped Slice 5 → 0028, but Slice 4 (k6 load
test, indicative 0027) is parked pending the owner-provisioned scratch
environment (D2/D10) and merges later — so this slice takes 0027 and
Slice 4's ADR takes the next free number when it lands. Scope never
shifts with the number.

## Context

Convention #6 and the Phase 8 deploy doc require a least-privilege,
non-owner app role in production. Phase 5 proved deny-all against a raw
connection — but only inside the test suite. Phase 10 owes an
**executable check that outlives the phase** and can be pointed at any
environment, production included, plus a backup/restore drill (a backup
that has never been restored is a hope, not a backup).

## Decision

### 1. `verify:db-role` — permanent, environment-agnostic check

`apps/api/scripts/verify-db-role.ts`, run as
`pnpm --filter @mesomed/api verify:db-role` (production shape: connect
with the app role's own credentials) or with `-- --set-role mesomed_api`
(owner/CI shape). Twelve checks, read-only by construction — each probe
either reads catalogs or is _expected to be denied_; the single DDL
probe drops its table in the only branch where it unexpectedly
succeeds:

- (1) no superuser / createdb / createrole / bypassrls;
- (2) role owns no tables;
- (3) DDL denied;
- (4–6) `clinical_access_log` INSERT/UPDATE/DELETE denied (append-only
  by privilege; the trigger additionally binds the owner — Phase 5
  proof);
- (7–9) direct SELECT denied on `encounters` / `visit_notes` /
  `prescriptions` (the convention #6 RLS tier, ADR-0010);
- (10–11) RLS enabled on exactly that tier with **zero** policies
  (deny-all posture);
- (12) the SECURITY DEFINER channel is executable (the working path).

### 2. CI-verified, with a negative control

`test/db-role-verify.test.ts` runs the real function against the
migrated embedded database: all twelve pass as `mesomed_api`, and the
owner/superuser connection **fails** it — proving the script
discriminates rather than flattering. The check list is pinned in the
test so a new check cannot ride in unseen.

### 3. Backup/restore drill — runbook now, execution at HG-3

`docs/runbooks/backup-restore.md`: dump/snapshot → restore into a
scratch instance → verification queries (row counts, freshness
timestamps, clinical-audit trigger spot-check) → `verify:db-role`
against the restored copy → record + tear down. Per D10 (nothing
deployed today) the drill targets the managed PG that will become
production; the launch checklist (the Slice 8 close-out ADR) carries a
re-drill item against real production. Cadence after launch: quarterly.

## Human gate — HG-3 (open)

Owner executes or supervises the drill per the runbook; the outcome
(backup timestamp, restore duration, verification results) lands here
as a dated amendment. Claude Code does not self-certify this.

## Consequences

- The Phase 5 RLS proof is now a one-command posture check usable
  against production read-only — deploy checklist and launch checklist
  both reference it.
- The drill runbook is provider-agnostic (pg_dump path + snapshot
  path); provider-specific console steps get filled in during HG-3
  against the actual managed instance.
