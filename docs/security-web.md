# Web App Security Posture (Phase 8)

Scope: `apps/web` (Next.js thin client). The API's own posture (authz
layers, RLS tier, webhook hardening) is recorded in the phase ADRs.

## Content-Security-Policy

Set per-request in `apps/web/proxy.ts`, in one of two modes keyed by path
— because browsers ignore `unsafe-inline` whenever a nonce is present, the
modes cannot be combined in a single header:

- **Nonce mode** (session-scoped, dynamically rendered areas: dashboards,
  admin): `script-src 'self' 'nonce-…' 'strict-dynamic'` — Next stamps the
  nonce onto its inline scripts (it reads the CSP from the request
  headers); `strict-dynamic` trusts only what those scripts load. No
  `unsafe-inline` for scripts in production; dev adds `unsafe-eval` for
  the React refresh runtime only.
- **Static mode** (public SSG pages — homepage, directory, search):
  `script-src 'self' 'unsafe-inline'`. These pages are prerendered and
  CDN-cacheable (ADR-0012 layer 1), so a per-request nonce is impossible
  by construction, and React's flight data ships as inline scripts that
  hashes can't practically pin. React's output escaping is the primary
  XSS control on these pages; the CSP still blocks foreign script
  origins, plugins, base hijacking, framing, and form exfiltration.
  Accepted trade-off, revisit if Next ships a static-compatible nonce
  mechanism.
- Both modes: `default-src 'self'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`,
  `upgrade-insecure-requests` (prod).
- Both modes: `connect-src 'self' <API origin>` — the single tRPC
  endpoint.
- `img-src 'self' data: blob:` — extend with the media host when facility
  media serves from object storage (`NEXT_PUBLIC_MEDIA_URL` drives the
  matching `next/image` remotePatterns allowlist in `next.config.ts`).
- `style-src 'self' 'unsafe-inline'`: Next injects inline style attributes
  during hydration; styles are not a script-execution surface. Revisit if
  style-based exfiltration ever enters the threat model.

Static headers (`next.config.ts`): `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (camera/mic/geolocation off), HSTS (2 years,
includeSubDomains), `X-DNS-Prefetch-Control: off`.

## CSRF posture (tRPC + same-site cookies)

- **Sessions** are Better Auth cookies (MM-DEC rev02): `HttpOnly`,
  `Secure` in production, `SameSite=Lax`. The browser attaches them to the
  API origin only.
- **State changes** go exclusively through tRPC **mutations = HTTP POST
  with a JSON body** (`content-type: application/json`). A cross-site form
  can only produce simple-request content types (`text/plain`,
  `x-www-form-urlencoded`, `multipart`), which tRPC rejects; a cross-site
  `fetch` with JSON triggers a CORS preflight, and the API's CORS layer is
  an **explicit origin allowlist with `credentials: true`, never
  reflection** (ADR-0002 / MM-QA-001 F-04) — the preflight fails for any
  origin not on the list.
- **tRPC queries are GET** and must stay side-effect-free; that is a
  design invariant of pragmatic CQRS (§3.2 — queries read freely, commands
  are mutations), not a convention to remember per procedure.
- **Conclusion:** SameSite=Lax + JSON-only mutations + allowlisted CORS
  with credentials closes the classic CSRF vectors without a synchronizer
  token. If a future endpoint ever accepts simple-request content types or
  a GET with side effects, that endpoint needs its own token — flag it in
  review.

## Known deviations / follow-ups

- None carried from rev01: it shipped no CSP, no security headers, and
  `images.unoptimized` — all three are closed above.
