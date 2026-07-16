# ADR-0028 — Phase 10 Slice 6: data-retention + erasure procedure (option B)

## Status

Accepted. Phase 10 Slice 6 per MM-DES-003 §7 (ruled plan, PR #50);
depth ruled **D7 = option B** (document + retention prune job;
crypto-shred designed, not built). Numbering per the §3 next-free rule
(Slice 4 remains parked; Slice 5 took 0027).

## Context

MM-PLAN-001 §5 Phase 10 requires the data-retention + erasure procedure
documented, with crypto-shred columns for PII where audit immutability
conflicts. ADR-0011 annotated the crypto-shred scope
(`notification_log.destination/params_json/appointment_id`,
`push_device_tokens.token`, `send_rate_events.key`, `abuse_alerts.key`,
12–24 month retention) and explicitly recorded "no retention job built
yet — scope recorded for a future phase". This slice closes that
carry-over at the ruled depth.

## Decision

1. **Runbook** `docs/runbooks/data-retention-erasure.md`: per-table
   retention/erasure matrix (clinical record never deleted — amendments
   only, convention #5; audit log permanent; PII tables windowed),
   legal-basis note, the manual erasure-request procedure usable today,
   and the recorded-not-built crypto-shred design (per-subject AES-GCM
   keys; erasure = key deletion; completion bounded by backup
   retention).
2. **Automated prune job**: pg-boss cron `data-retention-prune`
   (`RETENTION_CRON`, default daily 02:30 UTC) on the existing job
   scheduler — no new infrastructure. Module-owned deletes
   (convention #1): communication prunes `notification_log`
   (`RETENTION_NOTIFICATION_LOG_DAYS`, default 540 — inside the
   ADR-0011 band; all statuses, expiry is the erasure action), the
   kernel prunes `send_rate_events`
   (`RETENTION_SEND_RATE_EVENTS_DAYS`, default 7 — the schema's own
   days-scale comment).
3. **`abuse_alerts` deliberately not in the job yet**: same 12–24-month
   band, but the ruled option B scope named the two tables above; the
   runbook records that adding `abuse_alerts` to the prune is a
   one-line change due before its window first becomes reachable
   (~launch + 12 months).
4. **Crypto-shred: not built** (D7). No compliance driver at launch and
   ~zero data volume; the design is recorded in the runbook so the
   retrofit stays a bounded, pre-planned change. Build triggers are
   listed there.

## Tests (convention #12)

`test/communication/retention.test.ts`: expired rows deleted (including
an over-window `pending` notification row), fresh rows kept — for both
tables, against the migrated embedded database.

## Consequences

- ADR-0011's "no retention job built yet" is closed; its 12–24-month
  annotation now has running enforcement for `notification_log` and the
  operational window for `send_rate_events`.
- Erasure requests are servable today via the manual procedure; the
  clinical/audit immutability conflict remains parked behind the
  crypto-shred build triggers, by explicit ruling.
- New env knobs default sensibly; no deploy action required.
