# Runbook — incident: DB degraded (MM-QA-004 Slice 4, ADR-0037)

**Severity: SEV1 when writes fail** (booking slot allocation and clinical
writes are single-transaction, strongly consistent — convention #4; if
Postgres can't commit, the SEV1 paths are down). **SEV2 when merely slow**
(elevated p95, eventual paths lagging). Postmortem required for both.

## 1. Detection signal

- `/ready` returns 503 with the `postgres` check failing
  (`apps/api/src/kernel/health.ts` — `select 1` probe); synthetic `/ready`
  probe fires.
- "API 5xx error rate high" alert (`mesomed-error-rate`) — DB errors surface
  as 5xx on command procedures; Sentry shows the failing routes.
- "API heartbeat absent" may ALSO fire: the heartbeat gauge is DB-derived
  (`apps/api/src/kernel/metrics.ts` — the callback queries `domain_events`),
  so a dead DB connection silences it. Heartbeat absent + platform says the
  process is running → suspect the DB first.
- api-latency dashboard: p95/p99 climbing (`http_server_duration_milliseconds`).

## 2. First 15 minutes

1. Classify: writes failing (SEV1) or slow (SEV2)? `curl /ready`, then try
   a read (`/trpc/booking.weekAvailability?input=…` for the test doctor).
2. Managed-PG provider console (the managed Postgres 16 per
   `docs/deploy/phase8-production-deployment.md`): CPU, memory, storage
   full, connection count, restart/failover events.
3. Connection saturation and runaway queries (psql as an admin role — the
   API's `mesomed_api` role is deliberately least-privilege, ADR-0027):

   ```sql
   select count(*), state from pg_stat_activity group by state;
   select pid, now() - query_start as runtime, state, left(query, 120)
     from pg_stat_activity
     where state <> 'idle' order by runtime desc limit 10;
   -- kill a runaway (take the pid from above):
   select pg_terminate_backend(<pid>);
   ```

4. Storage full is the classic silent killer on free/small tiers: check
   disk, and if the growth is `domain_events` or pg-boss tables, see
   `incident-outbox-stalled.md` (a stalled dispatcher grows both).
5. If the DB is simply down: provider restart/failover. **PITR/restore is
   the disaster path, not the routine path** (MM-ARC-002 §10.6) — reach for
   `docs/runbooks/backup-restore.md` only when the provider declares data
   loss, and restore into a NEW instance, never over the source.

## 3. Escalation

Owner is the responder (`mesomed-owner-email` contact point). Escalate to
the managed-PG provider's support for infrastructure faults (their status
page first). If restore-from-backup becomes necessary, that is HG-3
territory: follow `docs/runbooks/backup-restore.md` end to end, including
the post-restore coherence checks. After any provider-side credential or
instance change, re-run the posture check: `pnpm --filter @mesomed/api
verify:db-role` against the production `DATABASE_URL` (ADR-0027 — 12-check
least-privilege posture).

## 4. Verification of recovery

- `/ready` 200, `postgres` check `ok: true`; 5xx alert back to Normal.
- p95 back to the ADR-0030 envelope (load test baseline: p95 read 71.7 ms,
  booking 74.0 ms at 10×) on the api-latency dashboard.
- Outbox backlog drains: `mesomed_outbox_lag_seconds` falls under 60s and
  `mesomed_outbox_pending` trends to 0 — the outage queued events, they
  must now clear (`incident-outbox-stalled.md` if not).
- Notification backlog drains: pending `notification_log` rows get sent by
  the sender loop (5s poll — `apps/api/src/modules/communication/sender.ts`).
- One synthetic guest-booking probe green end to end.
- Postmortem; if saturation caused it, record the connection/scale decision
  in the risk register.
