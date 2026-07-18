# Synthetic probes — config as docs (MM-QA-004 Slice 4, ADR-0037)

External uptime + spine probes per MM-ARC-002 §10.8 ("uptime probes on
`/health` + `/ready`" and "a scripted guest-booking against staging hourly
and production (against a designated test doctor) daily"). This file is the
provisioning spec; **provisioning itself is HG-2 owner work** (Grafana Cloud
free-tier stacks cannot be provisioned from this repo — same posture as the
dashboards and alert rules, ADR-0026). The owner performs these steps in
Grafana Cloud → **Testing & synthetics → Synthetic Monitoring** during HG-2
and records the outcome in the ADR-0026 HG-2 amendment.

Why external probes exist at all: every committed alert evaluates metrics
the API process exports about itself, including the ADR-0037 heartbeat
rule — a wrong DNS record, an expired TLS cert, or a platform-edge failure
leaves the process healthy and the users locked out. Only an outside-in
check catches that class.

## 1. HTTP check — `GET /health`

Liveness: `/health` never consults dependencies (`apps/api/src/kernel/health.ts`,
liveness/readiness split per MM-QA-001 F-13; route registered in
`apps/api/src/app.ts` — `app.get("/health", …)`).

| Setting        | Value                                                             |
| -------------- | ----------------------------------------------------------------- |
| Target         | `https://<api-domain>/health` (the deployed API host, deploy doc) |
| Method         | GET                                                               |
| Frequency      | every 60s                                                         |
| Timeout        | 5s                                                                |
| Probe location | 2+ locations (nearest EU probes; free-tier allowance is plenty)   |
| Assert status  | 200                                                               |
| Assert body    | contains `"status":"ok"` (the `healthPayload()` contract:         |
|                | `{ status: "ok", service: "api", timestamp }`)                    |

## 2. HTTP check — `GET /ready`

Readiness: `/ready` returns 200 only when Postgres answers, the expected
migrations are applied, and the outbox dispatcher is started; otherwise it
returns **503** with the failing check named in `checks[]`
(`apps/api/src/app.ts` — payload built by `readinessPayload()` in
`kernel/health.ts`: checks `postgres`, `migrations`, `dispatcher`).

| Setting        | Value                         |
| -------------- | ----------------------------- |
| Target         | `https://<api-domain>/ready`  |
| Method         | GET                           |
| Frequency      | every 60s                     |
| Timeout        | 5s                            |
| Probe location | same set as the /health check |
| Assert status  | 200                           |

## 3. Alerting for both HTTP checks

Synthetic Monitoring emits `probe_success` into the stack's Prometheus.
Enable the check-level alert ("alert sensitivity: high" — fires when the
probe fails from multiple locations) and route it through the default
notification policy to the existing `mesomed-owner-email` contact point
(`docs/observability/alerts/contact-points.yaml`; D3 ruling). A `/health`
probe failure with the heartbeat alert quiet points at DNS/TLS/edge, not
the process — see `docs/runbooks/incident-api-down.md`.

## 4. Scripted guest-booking probe (MM-ARC-002 §10.8)

The one check that exercises the whole spine: availability read → guest
booking write → outbox emit. **Staging: hourly. Production: daily, against
a designated test doctor** whose `doctorLocationId` the owner fixes at
provisioning time. Implemented as a Synthetic Monitoring **scripted (k6)
check**.

Real call shapes (no auth needed — both procedures are `publicProcedure`,
`apps/api/src/modules/booking/router.ts`; tRPC mounted at `/trpc`,
`apps/api/src/app.ts`; no transformer is configured, so plain JSON):

1. `GET /trpc/booking.weekAvailability?input=<url-encoded JSON>` with input
   `{"doctorLocationId":"<TEST_DOCTOR_LOCATION_ID>"}` — input schema
   `weekAvailabilityInputSchema` (`packages/contracts/src/booking.ts`:
   `doctorLocationId` uuid, optional `anchor` ISO datetime). Response
   `days[7]`, each with `slots[{startsAt, endsAt}]`; pick the first free
   slot.
2. `POST /trpc/booking.guestBook` with JSON body per `guestBookInputSchema`
   (`packages/contracts/src/booking.ts`):
   `{"doctorLocationId": "...", "startsAt": "<slot.startsAt>", "patient":
{"fullName": "Synthetic Probe", "phone": "<PROBE_PHONE>"}}`.
   Assert 200 and `result.data.appointmentId` present with
   `status` from the `bookResultSchema` enum.

k6 skeleton (paste into the scripted-check editor; set the three env vars
in the check config):

```js
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.API_BASE_URL; // https://<api-domain>
const DOCTOR_LOCATION_ID = __ENV.TEST_DOCTOR_LOCATION_ID;
const PROBE_PHONE = __ENV.PROBE_PHONE; // +964… — see constraints below

export default function () {
  const availInput = encodeURIComponent(JSON.stringify({ doctorLocationId: DOCTOR_LOCATION_ID }));
  const avail = http.get(`${BASE}/trpc/booking.weekAvailability?input=${availInput}`);
  check(avail, { "availability 200": (r) => r.status === 200 });

  const days = avail.json("result.data.days") ?? [];
  const slot = days.flatMap((d) => d.slots)[0];
  if (!slot) return; // fully booked week: read path verified, skip the write

  const book = http.post(
    `${BASE}/trpc/booking.guestBook`,
    JSON.stringify({
      doctorLocationId: DOCTOR_LOCATION_ID,
      startsAt: slot.startsAt,
      patient: { fullName: "Synthetic Probe", phone: PROBE_PHONE },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(book, {
    "guestBook 200": (r) => r.status === 200,
    "appointmentId returned": (r) => !!r.json("result.data.appointmentId"),
  });
}
```

Operational constraints (all verified against the code, not optional):

- **`PROBE_PHONE` must be a real, owner-controlled `+964` number.** The
  destination-country allowlist is fail-closed and Iraq-only at launch
  (`communication.destination_countries`, default `IQ: +964` —
  `packages/config/src/index.ts`), and a guest booking plans real
  notifications: the probe number will receive them. Guest booking
  find-or-creates one patient profile per normalized phone (convention #7),
  so the probe accretes exactly one profile — `patientProfileCreated:
false` from the second run on.
- **The probe cannot clean up after itself.** `booking.cancel` requires an
  authenticated patient/secretary/doctor/admin session
  (`apps/api/src/modules/booking/router.ts` — `roleProcedure`), and the
  probe is deliberately unauthenticated (it tests the public guest path).
  The designated test doctor's secretary account cancels the probe
  appointments (production is one per day), or they simply no-show —
  either way they stay confined to the test doctor's calendar.
- Frequency: staging hourly / production daily per §10.8 — the probe
  writes real rows (`appointments`, `patient_profiles`,
  `notification_log`, `domain_events`), which is exactly why production is
  daily and pinned to a test doctor.
- Alerting: same routing as §3; a failed spine probe with `/health` green
  is a booking-path regression, SEV1 per the MM-ARC-002 §10.9 ladder.
