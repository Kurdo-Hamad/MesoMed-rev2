# Phase 8 — Production Deployment Configuration

> **Correction (2026-07-13):** this doc originally described the web app as
> a container deployment (Dockerfile, build-args, a reverse-proxy/CDN in
> front of both web and API). That was an error in this doc, not an
> approved deviation — MM-PLAN-001 §1 (CI/CD row) and ADR-0016 both lock
> web → Vercel, with only the API shipping as a Docker image → Railway/Fly.
> The "Web container" section and the Topology diagram below are corrected
> to match. No architecture decision changed; nothing here was ever
> executed against production.

Prepared per the Phase 8 gate: **nothing here has been executed against
production**. Every step marked ☐ MANUAL is yours to perform or authorize.

## Topology

```
                    ┌── web (Vercel) ── mesomed.krd, www.mesomed.krd (redirect)
Internet ───────────┤       Next.js built + hosted on Vercel; Vercel's own
                    │       CDN/edge network, not a container, not behind
                    │       the API's reverse proxy
                    │
                    └── api.mesomed.krd ── TLS/CORS boundary
                              └── apps/api/Dockerfile (Fastify+tRPC, port 4000)
                                    └── Postgres 16 (managed, private network)
```

- **Web** deploys to Vercel, built directly from `apps/web` (no
  Dockerfile, no build-args) — see the Web (Vercel) section below.
- **API** is the only Docker image (`apps/api/Dockerfile`) → Railway/Fly,
  behind its own TLS termination and CORS boundary at `api.mesomed.krd`.
  CI already builds this image.
- Session cookies are cross-origin (web → api) but same registrable
  domain (`mesomed.krd` / `api.mesomed.krd`) so the Better Auth cookie
  (SameSite=Lax) rides tRPC calls.
- Public-path caching (`s-maxage` — ADR-0012 layer 1): Vercel provides
  this natively for web; never cache `/trpc/identity.*`, `/api/auth/*`,
  or anything under `/dashboard` (the app already marks session pages
  dynamic + nonce-CSP).

## API environment (validated by `apps/api/src/env.ts` at boot)

| Variable                                             | Value                                | Notes                                                                                                 |
| ---------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| NODE_ENV                                             | production                           | refuses to boot with any mock adapter wired                                                           |
| PORT                                                 | 4000                                 |                                                                                                       |
| DATABASE_URL                                         | ☐ MANUAL — managed PG16 conn string  | least-privilege role, NOT the DB owner (convention #6); see below                                     |
| CORS_ORIGINS                                         | https://mesomed.krd                  | explicit allowlist, no wildcard (ADR-0002) — canonical origin only, not www                           |
| DEFAULT_COUNTRY                                      | IQ                                   |                                                                                                       |
| TRUST_PROXY                                          | ☐ MANUAL — proxy IPs/CIDRs           | REQUIRED behind the proxy (ADR-0011 F-5) — without it the OTP/AI rate guards collapse onto one bucket |
| BETTER_AUTH_SECRET                                   | ☐ MANUAL — `openssl rand -base64 32` | store in the platform's secret manager                                                                |
| BETTER_AUTH_URL                                      | https://api.mesomed.krd              | verification links/callbacks                                                                          |
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
   **Hard precondition: step 3 must have completed against this same
   database.** Seeding is not merely ordered after migrating — the seed
   refuses to start when the database's applied-migration count is below
   the count the code expects, and exits with the shortfall message
   rather than failing partway through on a constraint violation
   (ADR-0056). If you see that message, the database is behind the code:
   re-run step 3 as the owner role, confirm `GET /ready` reports the
   `migrations` check `ok`, then re-run this step.
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

## Web (Vercel)

Web deploys to Vercel, built directly from `apps/web` — no Dockerfile, no
Docker build-args, no container runtime env. `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_MEDIA_URL` are set as environment variables in Vercel's
project settings (Production environment), not baked in via build-args.
Domains: `mesomed.krd` (canonical) with `www.mesomed.krd` redirecting to
it, both configured in Vercel's domain settings. CSP, security headers,
and locale routing are in the app itself (`proxy.ts`) and apply
unchanged under Vercel.

## ☐ MANUAL checklist (everything you must do or authorize)

1. DNS + TLS for `mesomed.krd`, `www.mesomed.krd` (redirect to canonical),
   and `api.mesomed.krd`.
2. Provision Postgres; run migrations + seed (§ Database).
3. Populate the secret manager with the table above; wire into the API
   service definition.
4. Build + push the API image (CI builds it; pushing/registry is not
   configured — decide registry + credentials). Web has no image to
   build or push — see item 6.
5. Deploy api → verify `GET /health` and `GET /ready`.
6. Connect Vercel to the repo, set the build environment variables
   (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MEDIA_URL`), deploy from
   `apps/web`, and verify `/en`, `/ar`, `/ckb` render and sign-in works
   end-to-end.
7. Bootstrap the first admin (§ Database step 5), then set config rows
   (§ Config rows).
8. ~~Point the CDN at web with `s-maxage` on public paths only.~~ Not
   needed for web — Vercel provides CDN/edge caching natively. Public-GET
   `s-maxage` caching is the app's own response headers, unchanged by
   this correction.

**Deploy is NOT executed autonomously — halting for your authorization per
the Phase 8 gate.**
