# Phase 8 — Production Deployment Configuration

Prepared per the Phase 8 gate: **nothing here has been executed against
production**. Every step marked ☐ MANUAL is yours to perform or authorize.

## Topology

```
Internet ── CDN/Reverse proxy (TLS, s-maxage caching — ADR-0012 layer 1)
              ├── web  : apps/web/Dockerfile  (Next.js, port 3000)
              └── api  : apps/api/Dockerfile  (Fastify+tRPC, port 4000)
                           └── Postgres 16 (managed, private network)
```

- Web and API are separate containers built from this repo's Dockerfiles.
  CI already builds the API image; the web image (`apps/web/Dockerfile`,
  added this phase) needs the **public API origin at build time**:
  `docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.<domain> .`
- Session cookies are cross-origin (web → api): serve both from the SAME
  registrable domain (e.g. `mesomed.example` and `api.mesomed.example`) so
  the Better Auth cookie (SameSite=Lax) rides tRPC calls.
- CDN: cache only public GET paths; never `/trpc/identity.*`, `/api/auth/*`,
  or anything under `/dashboard` (the app already marks session pages
  dynamic + nonce-CSP).

## API environment (validated by `apps/api/src/env.ts` at boot)

| Variable                                             | Value                                | Notes                                                                                                 |
| ---------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| NODE_ENV                                             | production                           | refuses to boot with any mock adapter wired                                                           |
| PORT                                                 | 4000                                 |                                                                                                       |
| DATABASE_URL                                         | ☐ MANUAL — managed PG16 conn string  | least-privilege role, NOT the DB owner (convention #6); see below                                     |
| CORS_ORIGINS                                         | https://\<web-domain\>               | explicit allowlist, no wildcard (ADR-0002)                                                            |
| DEFAULT_COUNTRY                                      | IQ                                   |                                                                                                       |
| TRUST_PROXY                                          | ☐ MANUAL — proxy IPs/CIDRs           | REQUIRED behind the proxy (ADR-0011 F-5) — without it the OTP/AI rate guards collapse onto one bucket |
| BETTER_AUTH_SECRET                                   | ☐ MANUAL — `openssl rand -base64 32` | store in the platform's secret manager                                                                |
| BETTER_AUTH_URL                                      | https://api.\<domain\>               | verification links/callbacks                                                                          |
| WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID     | ☐ MANUAL                             | real OTP channel — production refuses mocks                                                           |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM | ☐ MANUAL                             | SMS fallback channel                                                                                  |
| RESEND_API_KEY / RESEND_FROM                         | ☐ MANUAL                             | email (provider verification mail)                                                                    |
| EXPO_PUSH_ACCESS_TOKEN                               | ☐ MANUAL (Phase 9)                   | push — may stay unset until mobile ships                                                              |
| ANTHROPIC_API_KEY / AI_TRIAGE_MODEL                  | ☐ MANUAL                             | symptom triage                                                                                        |
| SENTRY_DSN / OTEL_EXPORTER_OTLP_ENDPOINT             | ☐ MANUAL (optional)                  | no-op when unset                                                                                      |
| REMINDER_CRON                                        | e.g. `0 4 * * *` (UTC)               | 07:00 Baghdad reminders                                                                               |

Rotation runbooks for every secret: `docs/runbooks/secrets-rotation-*.md`.

## Database (☐ MANUAL, in order)

1. Provision managed Postgres 16; create database `mesomed`.
2. Create a least-privilege app role (no SUPERUSER/OWNER — the clinical
   RLS + SECURITY DEFINER audit path depends on the API NOT being owner).
3. Run migrations as the migration (owner) role:
   `DATABASE_URL=<owner-url> pnpm --filter @mesomed/db db:migrate`
4. Seed the directory + config (idempotent, run as app role):
   `DATABASE_URL=<app-url> pnpm --filter @mesomed/api seed`
5. Bootstrap the first admin: create the account via the web sign-up
   (provider tab), verify the email, then insert the admin role row —
   `INSERT INTO user_roles (user_id, role) SELECT id, 'admin' FROM "user" WHERE email = '<you>';`

## Config rows the admin sets after boot (data, not env — convention #9)

Through the admin suite / typed admin procedures:

- Listing tiers + per-country prices (`billing.upsertListingTier`,
  `billing.setTierPrice`).
- Payment routing per (country, kind) → gateway (`billing.setPaymentRouting`;
  only `manual` is wired until a real gateway adapter lands).
- Country gating (`directory.setCountryGating`), categories/specialties.
- Mobile minimum version (`mobile.compat` config row) — leave absent until
  Phase 9 ships a mobile client.

## Web container

No runtime secrets. Runtime env: `PORT=3000`. Build args (baked in):
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MEDIA_URL`. CSP, security headers, and
locale routing are in the app itself (`proxy.ts`).

## ☐ MANUAL checklist (everything you must do or authorize)

1. DNS + TLS for `<domain>` and `api.<domain>`.
2. Provision Postgres; run migrations + seed (§ Database).
3. Populate the secret manager with the table above; wire into the API
   service definition.
4. Build + push both images (CI builds them; pushing/registry is not
   configured — decide registry + credentials).
5. Deploy api → verify `GET /health` and `GET /ready`.
6. Deploy web (built with the real `NEXT_PUBLIC_API_URL`) → verify /en,
   /ar, /ckb render and sign-in works end-to-end.
7. Bootstrap the first admin (§ Database step 5), then set config rows
   (§ Config rows).
8. Point the CDN at web with `s-maxage` on public paths only.

**Deploy is NOT executed autonomously — halting for your authorization per
the Phase 8 gate.**
