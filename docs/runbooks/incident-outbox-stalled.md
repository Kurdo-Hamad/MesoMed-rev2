# Runbook — incident: outbox stalled / DLQ growing (MM-QA-004 Slice 4, ADR-0037)

**Severity: SEV2** — commands still commit (bookings, clinical writes are
strongly consistent in their own transaction, convention #4); what degrades
is everything event-driven: notifications, search indexing, billing
follow-ups (SEV2 = degraded eventual paths, MM-ARC-002 §10.9). It does NOT
self-heal if rows are dead-lettering — handle it the same day.

## 1. Detection signal

- **"Outbox lag high" alert** (`mesomed-outbox-lag`): oldest pending
  `domain_events` row older than 60s for 5m (`max(mesomed_outbox_lag_seconds)`).
- outbox-health dashboard: `mesomed_outbox_pending` climbing; dead-letter
  dashboard: `mesomed_outbox_dead` > 0 (all three gauges from
  `registerOutboxMetrics`, `apps/api/src/kernel/metrics.ts`).
- `/ready` 503 with the `dispatcher` check failing = the dispatcher never
  started (`apps/api/src/kernel/health.ts`).

## 2. First 15 minutes

1. API logs first: the dispatcher logs pg-boss errors
   (`boss.on("error", …)`) and `"domain event dead-lettered after
exhausting retries"` with the `eventId`
   (`apps/api/src/kernel/dispatcher.ts`).
2. State of the outbox (`domain_events`, `packages/db/src/schema/kernel.ts`;
   lifecycle `pending → published → processed | dead`):

   ```sql
   select status, count(*) from domain_events group by status;
   -- oldest stuck rows (what the lag gauge is measuring):
   select id, name, version, attempts, occurred_at
     from domain_events where status = 'pending'
     order by occurred_at limit 20;
   -- dead-lettered rows, with the handler error that killed them:
   select id, name, version, attempts, occurred_at, left(last_error, 300)
     from domain_events where status = 'dead'
     order by occurred_at desc limit 20;
   ```

3. pg-boss side (queues `domain-events` and dead-letter
   `domain-events.dead`, `dispatcher.ts`; schema created by pg-boss itself,
   `migrate: true` — pg-boss ^12, `apps/api/package.json`):

   ```sql
   select name, state, count(*) from pgboss.job
     where name in ('domain-events', 'domain-events.dead')
     group by name, state;
   ```

4. Diagnose by shape:
   - **Everything `pending`, nothing `dead`, dispatcher check failing** →
     the dispatcher/pg-boss didn't start: restart the API instance; check
     boot logs for pg-boss migration errors.
   - **Rows flowing but one event name accumulating `dead`** → a handler
     bug: `last_error` carries the stack. Fix ships first; do NOT redrive
     until the fix is deployed (redriving into the same bug re-dead-letters
     with burned attempts).
   - **Lag high, `dead` = 0, counts draining slowly** → throughput, not
     failure: usually DB pressure — `incident-db-degraded.md`.

## 3. Escalation

Owner-responder. If dead-letters expose a contract violation (an emitted
payload its own Zod contract rejects — `registry.parse` failure in
`dispatcher.ts`), that is a code defect: named-slice fix + ADR, not an ops
workaround (convention #3). Escalates to SEV1 only if the stall is a
symptom of DB failure taking the write path with it.

## 4. Verification of recovery — including redrive

**Redrive mechanism (the honest state):** the dispatcher has a
`redeliver(eventId)` method (`dispatcher.ts` — runs one event through the
normal idempotent handler path), but **it is not exposed anywhere** — no
admin procedure, route, or CLI calls it. There is no automated DLQ redrive.
The real mechanism is manual SQL: flipping a row back to `pending` puts it
in front of the pump's poll (`status = 'pending' order by occurred_at`,
`dispatcher.ts`), which republishes it. Safe by design: every handler first
claims a `processed_events` row in its own transaction, so handlers that
already succeeded no-op on redelivery (effectively-once per event+handler).

```sql
-- redrive one dead event (after the handler fix is deployed):
update domain_events
   set status = 'pending', attempts = 0, last_error = null
 where id = '<event-id>' and status = 'dead';

-- bulk redrive one event name:
update domain_events
   set status = 'pending', attempts = 0, last_error = null
 where name = '<event.name.vN>' and status = 'dead';
```

Then verify:

- `mesomed_outbox_lag_seconds` < 60 and falling; `mesomed_outbox_pending`
  → 0; `mesomed_outbox_dead` reduced by exactly the redriven count.
- `select status, count(*) from domain_events group by status;` shows the
  redriven rows reaching `processed`.
- Downstream effects materialized (e.g. `notification_log` rows planned
  for a redriven booking event).
- SEV2 postmortem; if a handler bug dead-lettered rows, the fix's test
  reproduces it (Testing DoD, convention #12).
