# ADR-0039 — MM-QA-004 Slice 5: password recovery (F-01, MM-DEC rev02 §5)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).
Implements MM-DEC rev02 §5 **as written** — implementing satisfies the
locked document, so no locked-doc amendment is needed (the ADR-0031
disposition amendment stated this explicitly).

## Context

MM-QA-004 F-01 (HIGH): password recovery was unimplemented for patients
and existed for providers only as the admin manual path
(`identity.recoverProviderAccount`), while §5 requires patient recovery
via WhatsApp OTP / email / SMS and provider self-service recovery via
verified email → WhatsApp OTP → SMS. ADR-0031's launch checklist omitted
it entirely (the F-01 aggravator).

## Decision

### Patient recovery (§5: "WhatsApp OTP, email, or SMS — patient's choice / whichever is available")

- **Phone leg (primary)**: Better Auth's phone-number plugin reset flow
  (`/phone-number/request-password-reset` + `/reset-password`), with
  `sendPasswordResetOTP` wired to the module's existing OTP dispatch
  service — per-phone send limit (`identity.otpSendPolicy`), kernel abuse
  guards, WhatsApp→SMS delivery order. The OTP is single-use (consumed
  atomically), short-lived (same 300s expiry as sign-up OTPs), and
  attempt-capped by the plugin.
- **Email leg**: Better Auth's core reset flow
  (`/request-password-reset` + `/reset-password`) — single-use token,
  15-minute expiry (`resetPasswordTokenExpiresIn: 900`). Patients with a
  claimed real email can use it; placeholder addresses are never mailed
  (and the response shape never discloses account existence).
- **Delegated ruling (ratification pending)**: "patient's choice /
  whichever is available" is implemented as choice between the phone-OTP
  flow and the email flow; within the phone flow, WhatsApp→SMS ordering
  is the existing adapter fallback chain rather than a per-message
  channel picker — the conservative reuse of proven machinery.

### Provider recovery (§5: "verified email → WhatsApp OTP → SMS, in that order of preference")

- **Verified email (primary)**: the same core reset flow — providers'
  emails are verified at signup (`requireEmailVerification`).
- **Phone leg (fallback)**: providers sign in with email and carry their
  phone on `provider_profiles`, not the Better Auth user — so the phone
  leg is a pair of PUBLIC identity procedures
  (`identity.requestProviderRecoveryOtp` /
  `identity.resetProviderPasswordByOtp`): OTP stored in Better Auth's
  verification store (same expiry), delivered through the same OTP
  dispatch service, **single-attempt** (the stored code is consumed
  before comparison — stricter than the plugin's 3-attempt budget; a
  fresh code is one rate-limited request away), constant-time compare,
  no-enumeration semantics (a miss returns the same shape and sends
  nothing; every failure mode returns one indistinguishable
  UNAUTHORIZED).
- **Admin manual path stays** as the exceptional fallback (unchanged).

### Cross-cutting

- **Sessions revoked on every reset** (§4): `revokeSessionsOnPasswordReset`
  covers both Better Auth flows; the provider phone leg calls
  `deleteUserSessions` explicitly (the recover-provider-account pattern).
- **Rate limiting**: every delivery leg rides the OTP-abuse machinery.
  The email leg uses the shared policy over `otp_send_attempts` with an
  `email:`-prefixed key (the column name is historical; it is the
  rate-limit key). Better Auth's reset endpoints deliberately return 200
  when a send is suppressed (no enumeration) — the enforced protection
  is that nothing is delivered once the budget is spent, which is what
  the tests pin.
- **Clients**: web gains `/{locale}/auth/forgot-password` (patient
  phone-OTP tab; provider email tab with phone fallback) and
  `/{locale}/auth/reset-password` (email-link landing); mobile gains the
  patient phone-OTP screen; both sign-in surfaces link to them. All
  strings in `web.auth` catalogs (en/ar/ckb, exact parity; ar/ckb carry
  the standing native-speaker gate); reset-email copy in
  `identity.email` catalogs.
- **Pinning**: the identity authz matrix gained an enumeration pin
  (`_def.procedures` diffed against the matrix — the F-07 mechanism,
  introduced here for this router; Slice 7 replicates it repo-wide) and
  entries for the new public procedures + the previously missing
  `deleteAccount`. The frozen mobile surface is unaffected (additive).

## Tests (convention #12)

`apps/api/test/identity/password-recovery.test.ts` (8): patient phone
reset happy path (sessions revoked, old password dead, OTP single-use);
expired OTP rejected; per-phone send limit exhausts delivery
(deterministic fresh-phone budget); provider email reset (token
single-use, sessions revoked); placeholder email never mailed; provider
phone recovery via tRPC (sessions revoked); request non-enumeration
(no send for a miss); wrong code burns the single-attempt OTP and the
password survives. Red-proof: with `revokeSessionsOnPasswordReset`
flipped off, both session-revocation tests fail; restored, all green.
Identity authz matrix extended (public procedures asserted
not-auth-rejected; enumeration pin fails on any unmatrixed procedure).

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
967 tests / 131 files, zero failed · build 3/3 — the Slice 4 post-slice
gate on the tree that squash-merged verbatim to main `aa05746` (CI
verified green, run 29623548379).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
979 tests / 132 files, zero failed · build 3/3 (api 596/71 with the
recovery suite and the extended authz matrix).
