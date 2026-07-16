# Runbook — Postgres backup/restore drill (Phase 10 Slice 5, ADR-0027)

**Status: the drill has NOT been executed yet — HG-3 (owner-executed or
owner-supervised) is open.** D10 (MM-DES-003 §8.1): nothing is deployed
today, so the drill targets the managed Postgres that will become
production, and the launch checklist (Slice 8 close-out ADR) carries a re-drill item
against real production before go-live.

A backup that has never been restored is a hope, not a backup. This
drill proves, end to end: (1) a backup exists and is recent, (2) it
restores into a scratch instance, (3) the restored data is coherent.

## 1. Take/locate the backup

Managed-provider path (expected: the managed PG chosen per
`docs/deploy/phase8-production-deployment.md`):

- Confirm automated daily snapshots are ON and note retention.
- Trigger a manual snapshot now (or use `pg_dump` for a logical copy):

```sh
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom --no-owner --file=mesomed-$(date +%Y%m%d).dump
```

`--no-owner`: the scratch instance restores under its own role; original
ownership is re-established by running migrations/grants, not by the
dump.

## 2. Restore into a scratch instance

Never restore over the source. Create a fresh scratch database/instance
(provider console or `createdb`), then:

```sh
pg_restore --dbname="$SCRATCH_DATABASE_URL" --no-owner --exit-on-error \
  mesomed-YYYYMMDD.dump
```

Snapshot path: restore the snapshot to a NEW instance from the provider
console instead.

## 3. Verify the restored data

Run each against BOTH source and scratch; values must match (allowing
for writes that happened after the backup point):

```sql
-- Row counts of the load-bearing tables
select 'appointments' t, count(*) from appointments
union all select 'patient_profiles', count(*) from patient_profiles
union all select 'domain_events', count(*) from domain_events
union all select 'clinical_access_log', count(*) from clinical_access_log;

-- Latest activity timestamps (freshness of the backup point)
select max(occurred_at) from domain_events;
select max(created_at) from appointments;

-- Clinical audit spot-check: append-only trigger still installed and firing
select count(*) from pg_trigger where tgname like '%clinical%append%' or tgname like '%access_log%';
update clinical_access_log set actor_user_id = 'x' where false; -- must NOT error (no rows)
-- and a real mutation attempt must raise CLINICAL_APPEND_ONLY:
-- update clinical_access_log set actor_user_id = 'x';  -- expect ERROR
```

Then run the least-privilege check against the scratch instance
(migrations/grants must have carried over in the dump):

```sh
DATABASE_URL="$SCRATCH_DATABASE_URL" pnpm --filter @mesomed/api verify:db-role -- --set-role mesomed_api
```

## 4. Record + tear down

- Record in ADR-0027 (dated amendment): backup timestamp, restore
  duration, verification results, any surprises.
- Drop the scratch instance.

## Cadence

Once now (HG-3), re-drill against real production at launch (Slice 8
close-out ADR checklist item), then quarterly.
