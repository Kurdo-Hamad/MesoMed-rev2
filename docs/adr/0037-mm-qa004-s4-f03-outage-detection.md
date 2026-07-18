# ADR-0037 — MM-QA-004 Slice 4: outage detection + incident runbooks (F-03)

## Status

Accepted. MM-QA-004 remediation Slice 4 per the remediation plan
(`docs/qa/MM-QA-004-Remediation-Plan.md`, Slice 4 · F-03). Documentation
and alert-config slice — no runtime code changes. Provisioning of the new
alert rule and probes remains HG-2 owner work (never self-certified).

## Context

MM-QA-004 F-03 (HIGH): a total API outage was undetectable by the launch
observability posture. Both committed alerts evaluate metrics exported by
the API process itself — the 5xx rule is `noDataState: OK` and the outbox
rule `noDataState: NoData`, so a dead API pages nobody. No uptime or
synthetic probes existed, and none of MM-ARC-002 §10.9's six incident
runbooks (API down, DB degraded, outbox stalled, provider outage, OTP
abuse, data breach) were written. The audit's re-verification confirmed
the sole HG-2 coverage was dashboard provisioning.

## Decision

### 1. Absence alert on the existing heartbeat gauge — no new metric

A third rule, `mesomed-api-heartbeat` ("API heartbeat absent"), added to
`docs/observability/alerts/alert-rules.yaml`: query
`max(mesomed_outbox_lag_seconds)` over a 5-minute lookback, reduce last,
**`noDataState: Alerting`**, with a deliberately unsatisfiable threshold
(`lt 0` — the gauge is non-negative by construction), so the rule fires
exclusively through the NoData mapping. This is the standard Grafana
absence-alert idiom.

Why gauge-absence rather than minting a new heartbeat metric:
`mesomed_outbox_lag_seconds` is already the API's always-on, DB-derived
gauge — `registerOutboxMetrics` (`apps/api/src/kernel/metrics.ts`)
observes it at every metric export (default 60s) for as long as the
process, its Postgres connection, and the OTLP pipeline live, precisely
because ADR-0026 chose a DB-derived gauge over a dispatcher-pushed one.
Its absence therefore covers all three page-worthy failure modes with
zero new code, no new metric name to translate, and no risk of a
heartbeat that keeps beating while the thing it vouches for is dead. A
new synthetic "up" metric would add surface without adding signal.

The two existing rules keep their `noDataState` values, now with in-file
rationale comments: 5xx `OK` is correct because a quiet period is
legitimate (no traffic ⇒ no error rate; solo-operator alert-fatigue rule,
MM-ARC-002 §10.8) **and** the silence case it used to mask is now owned by
the heartbeat rule; outbox `NoData` is correct because that rule's job is
"lag high", and mapping its NoData to Alerting too would double-page the
same outage.

### 2. Synthetic probes as config-as-docs

`docs/observability/synthetic-probes.md` specifies the two Grafana Cloud
Synthetic Monitoring HTTP checks (`GET /health` expect 200 + body
`"status":"ok"`; `GET /ready` expect 200 — routes in
`apps/api/src/app.ts`, payloads in `kernel/health.ts`) and the MM-ARC-002
§10.8 scripted guest-booking probe (k6 skeleton against the real public
procedures `booking.weekAvailability` / `booking.guestBook`, staging
hourly, production daily against a designated test doctor). Config-as-docs
because the Grafana Cloud stack is owner-provisioned (same posture as the
ADR-0026 dashboards); the spec records the exact settings so HG-2 is
transcription, not design. Probes are the only layer that catches
DNS/TLS/edge failures the process-exported metrics cannot see.

Recorded constraints (verified in code): the probe phone must be an
owner-controlled `+964` number (fail-closed destination allowlist,
`packages/config/src/index.ts`), and the probe cannot cancel its own
appointment (`booking.cancel` requires an authenticated role) — cleanup is
clinic-side.

### 3. Six incident runbooks (MM-ARC-002 §10.9)

`docs/runbooks/incident-{api-down,db-degraded,outbox-stalled,
provider-outage,otp-abuse,data-breach}.md` — one page each, house style,
each structured detection signal → first 15 minutes → escalation →
verification of recovery, carrying the SEV ladder (SEV1 booking/clinical
write path down; SEV2 degraded eventual paths; SEV3 cosmetic) and only
mechanisms verified in code (config keys from `packages/config`, tables
from `packages/db`, dispatcher/sender behavior from `apps/api`).

Mechanism gaps found while writing them, recorded as facts in the
runbooks rather than papered over:

- No exposed outbox redrive: `dispatcher.redeliver()` exists but nothing
  calls it; the documented mechanism is manual SQL flipping `dead` rows to
  `pending` (safe via `processed_events` idempotency claims).
- The notification kill switch marks rows `denied` (terminal) and
  exhausted retries mark rows `failed` (terminal) — "queue drains later"
  holds only for outages shorter than the ~15-minute retry envelope;
  recovery includes a manual redrive UPDATE.
- No per-number/per-IP blocklist exists for OTP abuse — only rate
  policies, budgets, country allowlist, and channel kill switches; a
  blocklist would be a named slice.
- No rotation runbook covers `DATABASE_URL`/`BETTER_AUTH_SECRET`/OTLP
  token — the data-breach runbook names them explicitly as
  provider-console work.

None of these gaps blocks launch; whether any becomes a slice is an owner
disposition against the risk register.

### 4. ADR-0031 amendment (to append to `docs/adr/0031-phase10-slice8-launch-checklist-closeout.md`)

> ### 2026-07-18 — MM-QA-004 Slice 4 (ADR-0037): HG-2 scope extended — synthetic probes + SENTRY_DSN
>
> Checklist item 5 (HG-2) is extended per the F-03 remediation. It now
> reads:
>
> | #   | Item                                                                                                                                                                                                                                                                                                                                                       | Status | Owner action                |
> | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------- |
> | 5   | **HG-2** — Grafana Cloud provisioned, OTLP env set on prod API, 4 dashboards render live data, **3** alert rules imported (incl. the ADR-0037 heartbeat-absence rule), alert email test-fired, **synthetic probes provisioned per `docs/observability/synthetic-probes.md`, and `SENTRY_DSN` set + test event confirmed** (`docs/observability/README.md`) | OPEN   | Owner provisions + confirms |
>
> Rationale: MM-QA-004 F-03 — without the heartbeat rule and external
> probes, a total API outage pages nobody; without `SENTRY_DSN`, the 5xx
> alert's triage instruction dead-ends. Runbooks for the six §10.9
> scenarios land in `docs/runbooks/` in the same slice.

## Consequences

- An API death now pages within ~5–10 minutes via metric absence, and the
  probe layer covers the outside-in failure modes; a written procedure
  exists for every §10.9 scenario.
- HG-2 grows three owner steps (heartbeat rule import, probe provisioning,
  Sentry DSN); it remains a single sitting.
- The runbooks' documented gaps (no exposed redrive, terminal
  denied/failed notification rows, no blocklist) are now explicit
  owner-visible facts; any fix is a future named slice.

## Gate

Pre-slice (uncached, WSL, repo root): format GREEN · lint/typecheck
20/20 · test 11/11 tasks, 967 tests / 131 files, zero failed · build
3/3 — the F-02 close-out post-slice gate on the tree that squash-merged
verbatim to main `119c5a7` (CI verified green, run 29622395218).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
967 tests / 131 files, zero failed · build 3/3 — unchanged from
baseline, as expected for a docs/config-only slice. Docs/config-only slice — test and build counts
expected unchanged from baseline; any drift is investigated, not waved
through.
