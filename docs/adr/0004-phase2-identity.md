# ADR-0004 — Phase 2 Identity: Better Auth, Phone-Keyed Patients, Provider Gate

**Status:** Accepted
**Date:** 2026-07-11
**Phase:** 2 — Identity (MM-PLAN-001 §5, implementing MM-DEC rev02 exactly)

## Context

Phase 2 delivers the identity module: Better Auth mounted on Fastify with
the Drizzle adapter and Postgres sessions; patients authenticating with
phone + password, phone ownership proven by WhatsApp-first/SMS-fallback
OTP at signup and recovery (no OTP on routine login); providers with
email + password and a verified email; guest patient profiles keyed on
the normalized phone; the atomic guest→account claim; the provider
pending → approved/rejected verification gate; roles enforced through the
Phase 1 kernel authz middleware; and six versioned identity events
emitted through the transactional outbox. MM-DEC rev02 supersedes rev01
and was committed to the repository at the start of this phase (rev01
removed; CLAUDE.md/README references reconciled).

## Decisions

1. **Better Auth 1.6.x with the `phoneNumber` plugin; patient accounts
   carry placeholder emails.** Better Auth requires an email per user, so
   phone-keyed patients sign up through `/sign-up/email` with a
   deterministic placeholder derived from the normalized phone
   (`p<digits>@phone.mesomed.invalid`). The `.invalid` TLD can never
   route mail (RFC 2606), the email-verification sender skips placeholder
   addresses, and placeholder emails can never log in because
   `requireEmailVerification` is on and placeholders are never verified.
   Phone sign-in requires a verified phone (`requireVerification`), so no
   unverified login path exists on either identifier. Signup carries
   `phoneNumber` as an additional field, validated by a before-hook
   against the same normalization rule the profile keys use.

2. **Phone normalization is a shared pure domain rule.**
   `packages/domain/identity/normalize-phone.ts` (IQ-default E.164) keys
   patient profiles, validates Better Auth phone fields, and is exported
   for clients. The API requires already-normalized values at the auth
   boundary rather than rewriting client input — Better Auth offers no
   rewrite hook for the signup field, and one canonical form on the wire
   keeps auth identifiers and profile keys provably identical.

3. **Transaction boundary (the honest version).** Better Auth commits its
   own `user`/`session`/`account`/`verification` writes; our events
   cannot share those transactions. The invariant we guarantee instead:
   **identity-module state (user_roles, patient_profiles) and the events
   describing it are written in one transaction**, inside
   `callbackOnVerification` (awaited by Better Auth, so a failure fails
   the verify endpoint). A meta-test forces the event write to fail and
   proves nothing survives — no role, no claim, no events. The repair
   path after such a failure is the idempotent `identity.claimProfile`
   procedure, which re-checks verified flags server-side.

4. **Claim rule.** The pure decision (`decideClaim`) rejects any claim
   without verified proof — there is no code path that claims without
   ownership proof, proven by a meta-test across all profile states. The
   proofs: (a) OTP-verified phone matching the profile key; (b) verified
   email matching the email stored on the guest profile ("the email on
   that profile", MM-DEC §2). The claim is a conditional UPDATE on
   `user_id IS NULL` under a row lock; a lost race maps to
   `PROFILE_ALREADY_CLAIMED`. No guest profile + verified phone creates
   the profile already-claimed in the same transaction. DB backstops:
   unique `normalized_phone`, unique claimed `user_id`.

5. **OTP split: transport vs policy.** `OtpChannel` (packages/platform)
   is one transport per channel with capturing mocks through Phase 2
   (MM-DEC §8); the _policy_ — per-phone send rate limit
   (ConfigService-driven, `identity.otpSendPolicy`, default 5/hour) and
   WhatsApp-first/SMS-fallback order — is identity-module code, fully
   tested against the mocks. Code generation/storage/expiry/verify
   attempts stay in Better Auth (`verification` table, `expiresIn`,
   `allowedAttempts`) rather than being duplicated. Rate-limit and
   delivery failures surface as 429 `RATE_LIMITED` / 502
   `OTP_DELIVERY_FAILED`.

6. **EmailChannel is mocked this phase.** MM-PLAN-001 originally had
   Resend live from Phase 2; rev02 explicitly mocks OTP transport until
   Phase 7 and is silent on email. Decision (user-approved): a mock
   EmailChannel mirroring the OtpChannel approach — verification-link
   logic is real and tested; Resend lands Phase 7 behind the same
   interface. No email secrets exist in Phase 2.

7. **Identity tables live in `packages/db/src/schema/identity.ts`**, not
   in a module-local `schema.ts` — drizzle-kit, the migration journal,
   and `expectedMigrationCount` are centralized in packages/db (same
   precedent as the kernel schema, ADR-0003). Ownership stays with the
   identity module (convention #1): other modules read only through
   published queries (`listApprovedProviders`, `isProviderPubliclyVisible`).
   Better Auth tables were transcribed from the installed version's
   resolved schema (`getAuthTables`); `apps/api/scripts/auth-cli-config.ts`
   documents regeneration after upgrades.

8. **Provider flow.** Signup creates the Better Auth user; the
   authenticated `identity.completeProviderSignup` mutation (idempotent,
   requires a verified email — so placeholder-email patients can't
   self-promote) creates the `pending` provider profile, grants the
   `doctor` role, and emits registration events. Pending providers can
   log in but are not publicly visible; `identity.setProviderStatus`
   (admin) validates transitions and emits
   `identity.provider_status_changed.v1` for Phase 7 notification
   dispatch. `identity.recoverProviderAccount` (admin) resets the
   password and revokes all sessions via Better Auth's server context and
   emits the `identity.provider_recovered.v1` audit event.

9. **Origin requirement in production.** Better Auth's CSRF protection
   rejects requests without an `Origin` header (`MISSING_OR_NULL_ORIGIN`)
   when `NODE_ENV=production`. Browsers and the Expo client always send
   one; non-browser callers (curl, server-to-server, smoke tests) must
   send an Origin from the trusted list. Discovered during the live-server
   gate transcript.

10. **Sessions.** 30-day rolling window refreshed daily (persistent until
    logout/password change/recovery — MM-DEC §4); `revokeOtherSessions`
    covers the lost-phone case; recovery and password change revoke
    sessions via Better Auth.

11. **drizzle-orm single-instance rule.** better-auth introduced a second
    peer-variant of drizzle-orm in the dependency graph, splitting column
    types at compile time. Query operators (`eq`, `and`, `sql`, …) are
    now re-exported from `@mesomed/db` and imported only from there.

12. **Router factory.** `appRouter` became `createAppRouter(identity)` so
    the identity router receives the Better Auth instance through the
    composition root instead of a module singleton; kernel context now
    carries the raw request (for auth-header APIs) and an
    `authenticatedProcedure` (session, no role yet) joins `roleProcedure`.

13. **Locale of auth messages.** OTP/verification messages use the
    platform default locale (ckb) this phase; per-user locale routing is
    a Phase 7 (communication) concern. Trilingual catalog keys exist and
    are parity-tested; ar/ckb translations flagged for native review.

14. **Mobile verification scope.** The gate item is proven by running the
    real Better Auth Expo client plugin (with expo-secure-store's exact
    storage surface, in-memory) against a live API instance: sign-in
    persists the session token, a recreated client restores the session
    (app-relaunch semantics), sign-out clears it. React-native device
    APIs are stubbed at module level only. On-device verification
    (Maestro) is Phase 9 per plan.

## Verification (Phase 2 gate)

All of the following run in `apps/api/test/identity/*`,
`apps/mobile/test/`, `packages/{domain,db,contracts,i18n,platform}` —
251 workspace tests total (86 API integration tests, 2 mobile), green
locally and in CI (lint, typecheck, test, build):

- Patient: signup → OTP (WhatsApp mock) → verify → session; login with
  phone+password sends no OTP; wrong password 401; unverified phone
  cannot sign in; placeholder email cannot sign in; non-normalized phone
  rejected at signup; session persists and dies on sign-out; idempotent
  re-verification emits no duplicate events.
- Provider: signup → blocked login until email verified (mock channel
  link) → login; pending can log in, not publicly visible; admin
  approve → visible + status event; reject with reason; same-status
  transition 409; admin recovery (new password works, all sessions
  revoked, audit event); revokeOtherSessions keeps only the caller.
- Claim: in-place upgrade preserves the guest row/history; verified-email
  path; email-mismatch rejected 412; cross-user claim rejected; no
  unverified claim path (meta-test, all profile states); forced event
  failure rolls back the entire verification transaction.
- OTP: 6-digit issue, wrong-code + verify-attempt limit, expiry, send
  rate limit 429 with nothing delivered (meta-test), WhatsApp→SMS
  fallback (code usable), both-fail 502.
- Authz: 22-case denial matrix (anonymous 401 on every procedure, wrong
  role 403 per role) + contract I/O checks; DB-level CHECK/unique
  guardrails each proven to fire.
- Mobile: session persisted in secure storage, restored by a relaunched
  client, cleared on sign-out.

## Deviations

- Provider profile creation is an explicit authenticated mutation rather
  than a signup side-effect (decision 8) — transactional, testable, and
  keeps the patient/provider distinction out of Better Auth hooks.
- `user_registered`/`role_assigned` for patients emit on first phone
  verification (or first email-path claim), not at raw Better Auth user
  creation — registration per MM-DEC is complete only with proof of
  ownership.
- MM-PLAN-001 §5 Phase 2 wording ("email verification (Resend)") is
  superseded by decision 6 (mock EmailChannel; Resend in Phase 7), as
  anticipated by MM-DEC rev02 §10.
