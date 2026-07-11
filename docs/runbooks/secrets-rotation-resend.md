# Secrets Rotation — Resend (Email)

**Adapter:** `packages/platform/src/email-resend.ts` (`createResendEmailAdapter`)
**Env vars:** `RESEND_API_KEY`, `RESEND_FROM`
**Consumers:** identity email verification (live since Phase 2), communication notification sender (secondary channel — always sent alongside push/WhatsApp per `communication/shared.ts`'s delivery plan, never the sole channel for a notification)

## Blast radius

`RESEND_API_KEY` is scoped at creation time in the Resend dashboard to a
specific set of permissions (recommend: send-only, no domain/DNS
management, no API-key management) and optionally to a specific verified
sending domain. If leaked with send-only scope: an attacker can send
arbitrary email from `RESEND_FROM` (reputational/spam risk to the sending
domain), but cannot read other API keys, alter DNS/domain verification, or
access account billing. Confirm the key's scope in the Resend dashboard
matches "send-only" before relying on this narrower blast-radius statement
— a key created with full account access has full account blast radius.

## Rotation steps (zero-downtime)

1. In the Resend dashboard → API Keys, create a **new** key with the same
   scope as the current one (send-only, same domain restriction if any).
   Do not revoke the old key yet.
2. Set the new key as `RESEND_API_KEY` in the deployment's secret store.
3. Roll the API instances (rolling restart).
4. Once every instance confirms on the new key (canary email — e.g. trigger
   a test verification email or notification), revoke the OLD key in the
   Resend dashboard.
5. Confirm: a request signed with the old key returns `401` from the
   Resend API. Email is always a secondary channel in the notification
   sender (push or WhatsApp is primary — see `communication/shared.ts`), and
   the sender's dispatch-test suite proves a failing email channel never
   blocks delivery via the primary channel (`dispatch.test.ts`, "a failing
   email channel doesn't block push delivery, and the email row fails
   after maxAttempts") — so a brief overlap or gap during this rotation
   degrades gracefully rather than failing user-visible delivery, EXCEPT
   for identity email verification, which has no fallback channel; keep
   the overlap window (steps 1–4) short for that reason.

## Production guardrail interaction

If `RESEND_API_KEY` or `RESEND_FROM` is unset, `buildServer` falls back to
the mock email adapter, and `NODE_ENV=production` refuses to boot
(`apps/api/test/mock-production-guard.test.ts`). Set both together.
