# ADR-0026 — Phase 10 Slice 3: observability — metrics, dashboards-as-code, alerts

## Status

Accepted. Phase 10 Slice 3 per MM-DES-003 §5 (ruled plan, PR #50).
**HG-2 (Grafana Cloud provisioning + live-data verification) is OPEN,
owner-only** — see the human-gate section below.

## Context

MM-PLAN-001 §5 Phase 10 requires dashboards for outbox lag, dead-letter
depth, booking funnel and p95s, plus alerts on outbox lag and error
rate. The stack is locked (§1): OTLP to any backend, starting Grafana
Cloud free tier — the backend is not a decision point. What existed
before this slice: trace export only (`kernel/otel.ts` had no metric
reader, so the Phase 7 channel-mix counter never left the process), a
dead-lettering outbox whose health was DB-derivable but unobserved, and
no dashboards or alerts at all.

## Decision

### 1. Metrics pipeline

`kernel/otel.ts` adds a `PeriodicExportingMetricReader` +
`OTLPMetricExporter` (new dependency
`@opentelemetry/exporter-metrics-otlp-http`, version-aligned with the
existing trace exporter) to the NodeSDK. Same no-op behavior without
`OTEL_EXPORTER_OTLP_ENDPOINT`; export interval is the standard
`OTEL_METRIC_EXPORT_INTERVAL` (default 60s). This also activates the
HTTP auto-instrumentation's `http.server.duration` histogram (verified
empirically — old-semconv name, milliseconds, `http_status_code`
attribute) — the p95 and error-rate source.

### 2. Outbox health — DB-derived observable gauges

`registerOutboxMetrics(db)` (kernel/metrics.ts, wired in app.ts):
`mesomed.outbox.lag_seconds` (age of oldest pending row),
`mesomed.outbox.pending`, `mesomed.outbox.dead`, observed by one SQL
query per metric export. DB-derived on purpose (MM-DES-003 §5): a
dispatcher-pushed metric goes silent exactly when the dispatcher dies;
the poll keeps reporting. The metric reader is the timer — no new
infrastructure. With no OTel SDK started the callback never runs.

### 3. Booking funnel — counters, not events

`mesomed.booking.created{kind}` and
`mesomed.booking.transitions{action}` incremented at success inside the
booking commands (`bookAppointment`, `transitionAppointment`). No new
event contracts for dashboards (convention #3; MM-DES-002 §5 "no recall
event" precedent). Rejected commands (authz, illegal transition, slot
conflict) never reach the increment — proven by test.

### 4. Dashboards + alerts as code — `docs/observability/`

Four dashboards (outbox-health, dead-letter, booking-funnel,
api-latency) as import-ready Grafana JSON; two alert rules + the email
contact point as Grafana provisioning YAML. **Starting thresholds
(ruled D3, recommendations accepted): outbox lag > 60s for 5m; 5xx > 2%
of requests for 5m** — expected to be tuned during the Slice 4 load
test, which doubles as the alert shakedown. Alert channel (D3):
email to hakeem.pijdary@gmail.com. Queries use Grafana Cloud's
OTLP→Prometheus name translation (`mesomed_outbox_lag_seconds`,
`mesomed_booking_created_total`,
`http_server_duration_milliseconds_*`); the README records that
adjusting names against the live translation during HG-2 is expected
tuning.

### 5. Tests (convention #12)

- `test/metrics-export.test.ts` — meta-test, sibling of otel.test.ts
  (ADR-0017 prior art): boots the real dist artifact against a mock
  OTLP collector, seeds a 2-minute-old pending row and a dead row, and
  asserts the exported gauge values and the presence of the HTTP
  duration histogram.
- `test/booking/metrics-funnel.test.ts` — integration: guestBook +
  confirm increment the right counters with the right attributes; a
  rejected duplicate confirm does not count.

### Finding recorded: OTel metrics API has no proxy provider

A meter obtained before `setGlobalMeterProvider()` is a permanent
no-op (unlike tracing's `ProxyTracerProvider`). Production is safe by
bootstrap order (instrumentation.ts starts the SDK before app modules
load — MM-QA-001 F-03 already forced this). Tests must import
`test/booking/metrics-setup.ts` first for the same reason; the
constraint is documented there and here.

### Fixed en route

The first cut of the outbox SQL attached `FILTER` to `extract(...)`
instead of the aggregate — invalid PostgreSQL that made every
observation throw. Caught by the meta-test before merge (the callback
swallows errors by SDK design, so only an end-to-end export assertion
could catch it — exactly why the Testing DoD demands integration
proof).

## Human gate — HG-2 (open)

Owner: provision Grafana Cloud, set OTLP env on the deployed API,
import dashboards + alerts, connect the email channel, send a test
notification, confirm live data on all four dashboards
(`docs/observability/README.md` steps). D10 note: nothing is deployed
today — the target is the managed environment that will become
production; the launch checklist (ADR-0031) carries re-verification.
Everything verifiable locally has been verified (the meta-test's mock
collector). This gate's completion lands as a dated amendment here.

## Consequences

- Metrics now actually export; the Phase 7 channel-mix counter becomes
  observable for free.
- One extra SQL aggregate query per export interval (60s) — negligible;
  it uses the existing `(status, occurred_at)` index.
- Slice 4's load test can watch its own effects (dashboards + alert
  shakedown), as sequenced in MM-DES-003 §3.
- The booking counters are process-local and reset on restart —
  correct for rate/increase() dashboard queries, unsuitable for exact
  totals (the DB remains the source of truth; convention #2).
