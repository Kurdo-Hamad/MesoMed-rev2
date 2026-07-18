# Runbook — incident: API down (MM-QA-004 Slice 4, ADR-0037)

**Severity: SEV1** — the booking and clinical write paths ARE the API
(MM-ARC-002 §10.9 ladder: SEV1 = booking or clinical write path down).
Blameless one-page postmortem required afterwards; feeds the risk register.

## 1. Detection signal

- **"API heartbeat absent" alert** (`mesomed-api-heartbeat`,
  `docs/observability/alerts/alert-rules.yaml`): `mesomed_outbox_lag_seconds`
  absent 5+ minutes. The gauge is exported by the API process itself
  (`apps/api/src/kernel/metrics.ts`, `registerOutboxMetrics`) — absence means
  the process is down, its DB connection is dead, or the OTLP pipeline broke.
- **Synthetic `/health` / `/ready` probe failures** (`docs/observability/synthetic-probes.md`)
  — the only signal that also catches DNS/TLS/platform-edge failures.
- What will NOT fire: the 5xx-rate alert (`noDataState: OK` — a dead API
  emits no metrics at all). Silence from it proves nothing.

## 2. First 15 minutes

1. Confirm from outside: `curl -sS https://<api-domain>/health` and
   `curl -sS https://<api-domain>/ready`. `/health` never consults
   dependencies; `/ready` returns 503 naming the failing check —
   `postgres`, `migrations`, or `dispatcher` (`apps/api/src/kernel/health.ts`).
2. Triage by combination:
   - `/health` unreachable + heartbeat absent → process/platform down: go to 3.
   - `/health` 200 but heartbeat absent → process alive, OTLP pipeline or
     DB connection broken — check `OTEL_EXPORTER_OTLP_ENDPOINT` /
     `OTEL_EXPORTER_OTLP_HEADERS` (`docs/observability/README.md` HG-2
     step 2) and Grafana Explore for the last sample.
   - `/health` unreachable but heartbeat present → edge/DNS/TLS, not the
     process: check the domain and platform edge status.
   - `/ready` 503 with `postgres` failing → switch to
     `docs/runbooks/incident-db-degraded.md`.
3. Check the platform (Railway/Fly — the API is the only Docker image,
   `docs/deploy/phase8-production-deployment.md`): provider status page,
   deploy history, crash-loop logs (pino, structured). A crash on boot
   right after a deploy is the common case — note the production
   mock-adapter guard refuses to boot when a vendor env var is missing
   (`apps/api/test/mock-production-guard.test.ts` posture; see the
   secrets-rotation runbooks).
4. Restart the service. If the crash correlates with a deploy, **roll back
   by redeploying the previous image digest** (MM-ARC-002 §10.6: immutable
   images make this one command; never a rebuild).

## 3. Escalation

Solo-operator reality: the owner (contact point `mesomed-owner-email`,
`docs/observability/alerts/contact-points.yaml`) is the responder. Escalate
outward when the cause is not in our code/config: platform provider support
ticket (Railway/Fly) for infrastructure failures, DNS registrar for domain
issues. If the DB is the root cause, continue in
`incident-db-degraded.md`; a suspected compromise (defaced responses,
unexpected admin activity) escalates to `incident-data-breach.md`.

## 4. Verification of recovery

- `/health` 200 and `/ready` 200 with all three checks `ok: true`.
- `mesomed_outbox_lag_seconds` reporting again in Grafana Explore, and the
  heartbeat alert back to Normal.
- Outbox drained: the outage backlog clears — `mesomed_outbox_pending`
  falls back toward 0 (outbox-health dashboard); if lag stays high, the
  dispatcher didn't come back — `incident-outbox-stalled.md`.
- Synthetic probes green from all locations; next scripted guest-booking
  probe passes.
- Record timeline + cause; SEV1 postmortem (one page, blameless) per
  MM-ARC-002 §10.9.
