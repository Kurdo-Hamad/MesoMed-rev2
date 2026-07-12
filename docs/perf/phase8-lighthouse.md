# Phase 8 — Lighthouse Gate Evidence

**Gate (MM-PLAN-001 Phase 8):** Lighthouse ≥ 90 in ALL categories.
**Method:** Lighthouse 13.4 CLI, default mobile simulation (simulated 4G +
4× CPU), Chromium 149 headless, production build (`next build` + `next
start`) against the dev-embedded API harness (embedded PG16, seeded
directory + e2e fixtures). One HTML report per page in `phase8/`.

| Page            | URL                                   | Perf | A11y | Best-Pr. | SEO | Agentic* |
| --------------- | ------------------------------------- | ---- | ---- | -------- | --- | -------- |
| Home (en)       | /en                                   | 92   | 100  | 92       | 100 | 100      |
| Home (ar)       | /ar                                   | 92   | 100  | 92       | 100 | 100      |
| Home (ckb)      | /ckb                                  | 92   | 100  | 92       | 100 | 100      |
| Directory       | /en/directory                         | 95   | 100  | 96       | 100 | 100      |
| Doctors browse  | /en/directory/doctors                 | 91   | 100  | 96       | 100 | 100      |
| Search          | /en/search                            | 94   | 100  | 96       | 100 | 100      |
| Doctor detail   | /en/doctor/dr-ahmed-doctor            | 93   | 100  | 96       | 100 | 100      |
| Facility detail | /en/facility/hawler-teaching-hospital | 92   | 100  | 92       | 100 | 100      |
| Guest booking   | /en/book/dr-ahmed-doctor              | 94   | 100  | 96       | 100 | 100      |
| Sign-in         | /en/auth/sign-in                      | 93   | 100  | 96       | 100 | 100      |
| Sign-up         | /en/auth/sign-up                      | 93   | 100  | 96       | 100 | 100      |
| Dashboard       | /en/dashboard                         | 93   | 100  | 96       | 100 | 100      |

\* "Agentic browsing" is a Lighthouse 13 experimental category that
postdates the Phase 8 plan; reported for completeness, all ≥ 90.

**Variance note:** performance scores on the WSL2 dev machine fluctuate
±4 between runs of the identical build (simulated-throttling scores are
sensitive to background load). The committed reports are the evidence
runs; unthrottled (`--throttling-method=provided`) runs score 100 with
FCP = LCP ≈ 0.2 s.

## What the budget forced (this slice)

1. **Lucide icons**: the `icons` map import shipped the whole library
   (~500 KB); its `DynamicIcon` replacement shipped a ~240 KB manifest.
   Replaced with a curated static healthcare icon map (few KB).
2. **Public detail pages server-rendered** (doctor/facility): client-fetch
   detail pages painted their content only after the JS + query waterfall.
3. **Homepage hero/categories server-rendered**; search + city-reactive
   feed remain client islands.
4. **LCP headings out of Suspense boundaries** (search, doctors browse,
   sign-in, sign-up): `useSearchParams` boundaries were serving an empty
   static shell, so the biggest text painted only at hydration; doctors
   browse also had CLS 0.15 from the unreserved grid (footer jump).
5. **Fonts**: `display: "optional"`; the 166 KB Arabic subset is not
   preloaded (it alone congested the simulated critical path of every
   page, including /en).
6. **SEO/meta**: per-locale `generateMetadata` description, `robots.ts`,
   `public/llms.txt`, definition-list markup fix, skeleton/card height
   parity, contrast fix on closed-day labels.
