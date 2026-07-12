# ADR-0016 — Phase 8: Web App (launchable milestone)

**Status:** Accepted
**Phase:** 8 (MM-PLAN-001 §5)
**Companions this phase:** ADR-0012 (caching seam, slice 0), ADR-0013
(mobile API compatibility), ADR-0014 (soft-delete semantics), ADR-0015
(org/tenant reserved design).

## What shipped (slices 0–8, each branch → PR → CI green → merge)

0. Caching seam (ADR-0012): kernel CacheAdapter + directory read cache
   with event-driven invalidation.
1. Web foundation: en/ar/ckb locale routing, tokens-driven Tailwind
   theme, next/font Noto pair, path-split CSP (nonce+strict-dynamic on
   session paths, unsafe-inline on static), security headers,
   remotePatterns image allowlist (no `unoptimized` regression).
2. Homepage: hero, category grid, recommended feed on the real
   featured-slot resolver via narrow published queries (§1.9).
3. Directory + detail pages (7 categories + home-nursing), FTS search,
   symptom triage UI with red-flag banner.
4. Guest booking (MM-DEC §1/§2 exactly) + auth screens (§3/§4 exactly);
   phone normalization promoted to `@mesomed/contracts/phone` as a wire
   contract.
5. Four role dashboards + admin suite; additive `booking.clinicDay` +
   `scheduling.myWorkplaces` queries with lifecycle actor-matrix parity.
6. Mobile compat policy (ADR-0013): UPGRADE_REQUIRED kernel gate,
   `mobile.compat` config row, 105-procedure frozen-surface CI pin.
7. Playwright e2e: guest booking (en/ar/ckb), provider signup →
   verification → visibility (event-driven flip observed on the public
   page), admin tier payment. New CI e2e job on the production build.
8. Lighthouse ≥90 all categories on all 12 audited pages
   (docs/perf/phase8-lighthouse.md + per-page HTML reports).

## Decisions of record

- **Rendering split refines ADR-0012 layer 1**: public pages
  (homepage, doctor/facility detail) are **dynamic at the origin** with
  short-revalidate data caching (`publicServerQuery`); the public cache
  is the HTTP/CDN layer, not build-time SSG. Forced by two real failures:
  (a) SSG froze live directory data into the build and made `next build`
  depend on a running API; (b) statically prerendered session pages
  could not carry the CSP nonce, so production dashboards never hydrated
  — caught by the e2e suite, fixed with force-dynamic dashboards +
  explicit middleware request-header forwarding.
- **Session reads stay client-side**; `publicServerQuery` is public-only
  by contract (the cookie never crosses the server-fetch path).
- **Icons are a curated static map** (category-icon.tsx): the lucide
  `icons` map (~500 KB) and DynamicIcon manifest (~240 KB) both sank the
  §3.8 budget. Config `iconKey`s resolve against the allowlist with a
  stethoscope fallback; extending the set is one import + one map line —
  a documented dent in convention #9, taken deliberately.
- **Fonts**: `display: "optional"` both families; the 166 KB Arabic
  subset is not preloaded (it congested every page's simulated critical
  path, including /en). Metric-adjusted fallbacks keep CLS 0.
- **E2e hermeticity**: the Playwright web build purges `.next` first —
  the persisted Next data cache replayed a previous harness's responses
  into a fresh database's run (a 384 ms false-pass caught in review).
- **Frozen-surface pin regeneration** happens only at a release cut
  (ADR-0013); regenerating to green a red pin is a review reject.

## Deviations / carry-ins (convention #14)

1. **MM-DEC §5 password recovery** — no server-side reset wiring has
   existed since Phase 2; the web ships no recovery UI. Carry-in to the
   next identity slice, recorded in slice 4 rather than silently faked.
2. **ckb/ar search-text normalization (MM-ARC-002 §1.7)** — did NOT land
   in Phase 7 or earlier and was not absorbed here; search remains
   Postgres `'simple'` FTS + pg_trgm (ADR-0005). Carry-in.
3. **ckb dates render via Intl fallback (English)** — V8/ICU carries no
   `ckb` CLDR locale, so `Intl.DateTimeFormat("ckb")` falls back. Needs
   a product decision (custom Sorani month-name catalog vs accepting the
   fallback); flagged in the RTL review set.
4. **Patient reschedule UI deferred** — dashboard offers cancel +
   re-book; the API's `booking.reschedule` is not yet surfaced.
5. **Notifications feed not surfaced** — `communication.
listRecentNotifications` has no dashboard panel yet.
6. **Admin subscription UI deferred** — `billing.
recordSubscriptionPayment` is admin-API only; the e2e drives it
   through the typed procedure with the admin session.
7. **Schema-level contract compatibility checking** deferred to Phase 9
   DoD per the phase instruction (the pin freezes path + kind).
8. **Lighthouse "agentic browsing"** is a Lighthouse-13 category that
   postdates the plan; reported (all ≥90) but treated as informational.
9. **RTL sign-off and production deploy are HALTED for the owner** per
   the gate — ar/ckb screenshots of every page are in
   docs/rtl-review/phase8/; the deployment configuration and manual-step
   checklist are in docs/deploy/phase8-production-deployment.md. Neither
   is self-certified or executed autonomously.
