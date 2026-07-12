# Secrets Rotation — Twilio SMS

**Adapter:** `packages/platform/src/sms-twilio.ts` (`createTwilioSmsAdapter`)
**Env vars:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`
**Consumers:** identity OTP send (SMS fallback when WhatsApp delivery fails, MM-DEC rev02 §8), communication notification sender (SMS fallback for the same reason — see `sender.ts`'s inline whatsapp→sms retry)

## Blast radius

`TWILIO_AUTH_TOKEN` paired with `TWILIO_ACCOUNT_SID` authenticates as the
full Twilio account (or subaccount, if one is provisioned for MesoMed — see
"Recommendation" below). Unlike the Meta token, this is account-wide: it
grants send-SMS from `TWILIO_FROM` but also read access to the account's
call/message logs and (if not a restricted subaccount) other account
resources. If leaked: an attacker can send arbitrary SMS billed to the
account, and can read message/call history for numbers on the account.

**Recommendation (if not already the case):** provision MesoMed under a
Twilio **subaccount** scoped to messaging only, so a leaked auth token's
blast radius is limited to that subaccount rather than the parent account.
This runbook's rotation steps apply identically whether the account is a
subaccount or the primary account.

## Rotation steps (zero-downtime)

1. In the Twilio Console → Account → API keys & tokens, request a
   **secondary auth token** (Twilio supports two live auth tokens
   simultaneously for exactly this purpose — this avoids the WhatsApp
   adapter's "generate new, don't revoke old yet" workaround since Twilio's
   primary/secondary mechanism is purpose-built).
2. Set the secondary token as `TWILIO_AUTH_TOKEN` in the deployment's secret
   store. `TWILIO_ACCOUNT_SID` and `TWILIO_FROM` do not change during a
   token rotation.
3. Roll the API instances (rolling restart — same reasoning as the WhatsApp
   runbook: env is read once at boot).
4. Once every instance confirms on the new token (canary SMS via a test
   OTP or notification), **promote the secondary token to primary** in the
   Twilio Console, which invalidates the old primary token.
5. Confirm: a request signed with the old (now-invalid) token returns
   `401` from the Twilio API. The notification sender retries with backoff
   on failure; OTP send has no further fallback below SMS, so this step
   must only be taken after step 3 is confirmed, not on a timer.

## Production guardrail interaction

Same mechanism as the WhatsApp runbook: if any of `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, or `TWILIO_FROM` is unset, `buildServer` falls back to
the mock SMS adapter, and `NODE_ENV=production` refuses to boot rather than
silently mocking (`apps/api/test/mock-production-guard.test.ts`). Set all
three together on any rotation or initial provisioning — a partial write
(e.g. new `TWILIO_FROM` for a new sending number, but the SID/token
unchanged) is fine; leaving any one of the three empty is not.
