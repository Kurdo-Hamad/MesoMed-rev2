# Observability — dashboards & alerts as code (Phase 10 Slice 3, ADR-0026)

Stack (locked, MM-PLAN-001 §1): pino + OpenTelemetry (OTLP) + Sentry;
backend = any OTLP endpoint, starting with **Grafana Cloud free tier**.
The API exports traces **and metrics** over OTLP/HTTP when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set (`apps/api/src/kernel/otel.ts`).

## What the API emits

| Metric (OTLP name)            | Type               | Source                                                 |
| ----------------------------- | ------------------ | ------------------------------------------------------ |
| `mesomed.outbox.lag_seconds`  | observable gauge   | DB poll: age of oldest `pending` `domain_events` row   |
| `mesomed.outbox.pending`      | observable gauge   | DB poll: `pending` row count                           |
| `mesomed.outbox.dead`         | observable gauge   | DB poll: `dead` (dead-lettered) row count              |
| `mesomed.booking.created`     | counter `{kind}`   | booking commands, by booking channel                   |
| `mesomed.booking.transitions` | counter `{action}` | lifecycle transitions, by action                       |
| `mesomed.notifications.sent`  | counter            | pre-existing channel-mix counter (Phase 7)             |
| `http.server.duration`        | histogram (ms)     | OTel HTTP auto-instrumentation — p95/error-rate source |

The outbox gauges are observed at each metric export (default 60s,
`OTEL_METRIC_EXPORT_INTERVAL` ms overrides). DB-derived on purpose: a
dispatcher-pushed metric goes silent exactly when the dispatcher dies.

**Prometheus name translation.** Grafana Cloud ingests OTLP and rewrites
names Prometheus-style: dots → underscores, counters gain `_total`, and
units append (`http.server.duration` (ms) →
`http_server_duration_milliseconds_*`). The committed dashboards/alerts
use the translated names. If a panel shows "no data" during HG-2, check
the actual name in **Explore** first — translation details shift between
Grafana Cloud versions; adjusting a query is expected tuning, not a bug.

## Files

- `dashboards/outbox-health.json` — outbox lag + pending backlog
- `dashboards/dead-letter.json` — dead-letter depth
- `dashboards/booking-funnel.json` — created by channel, transitions by action
- `dashboards/api-latency.json` — p95/p99 + 5xx error rate
- `alerts/alert-rules.yaml` — the two launch alerts (thresholds: ADR-0026)
- `alerts/contact-points.yaml` — email contact point (D3 ruling)

## HG-2 — owner provisioning steps (human gate, never self-certified)

1. Create the Grafana Cloud free-tier stack.
2. In the stack, create an OTLP token; on the deployed API set:
   - `OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<zone>.grafana.net/otlp`
   - `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 instance:token>`
3. Import the four dashboards (Dashboards → New → Import → paste JSON;
   pick the stack's Prometheus datasource when prompted).
4. Import the alert rules + contact point (`alerts/README` header inside
   each file documents the provisioning-API call), or recreate them in
   the UI with the same queries/thresholds — outbox lag > 60s for 5m;
   5xx > 2% of requests for 5m (both ADR-0026, tuned during Slice 4).
5. Confirm the alert channel delivers: email to hakeem.pijdary@gmail.com
   (D3 ruling) — send a test notification from the contact point.
6. Confirm **live data renders on all four dashboards**, then record the
   gate as done (dated amendment in ADR-0026).
