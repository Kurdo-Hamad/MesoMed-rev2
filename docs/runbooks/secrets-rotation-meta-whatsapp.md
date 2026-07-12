# Secrets Rotation — Meta WhatsApp Cloud API

**Adapter:** `packages/platform/src/whatsapp-meta.ts` (`createMetaWhatsAppAdapter`)
**Env vars:** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_BASE_URL` (optional, defaults to the Meta Graph API base)
**Consumers:** identity OTP send/verify (primary channel, MM-DEC rev02 §8), communication notification sender (booking confirmations, reminders, prescription-issued notice — primary channel per the push-then-whatsapp-then-email order in `communication/shared.ts`)

## Blast radius

`WHATSAPP_ACCESS_TOKEN` is a long-lived Meta system-user access token scoped
to the WhatsApp Business Account (WABA) and phone number ID above — nothing
else. It grants send-message permission on that phone number only; it does
not grant WABA admin, billing, or other product access. Loss of this token
alone (without the phone number ID, which is not secret) does not expose
patient data — it only allows sending WhatsApp messages as the platform's
business number. If leaked: an attacker could send arbitrary WhatsApp
messages appearing to come from MesoMed to any phone number, and could
exhaust the WABA's messaging rate/quota. It does **not** grant read access
to conversation history, other WABA phone numbers, or the underlying Meta
Business Manager account.

## Rotation steps (zero-downtime)

1. In Meta Business Manager → WhatsApp Manager → the target phone number →
   API Setup, generate a **new** system-user access token (do not revoke the
   old one yet — Meta system-user tokens do not expire, so both can be valid
   simultaneously).
2. Set the new token as `WHATSAPP_ACCESS_TOKEN` in the deployment's secret
   store (not committed to the repo — `.env.example` only documents the var
   name).
3. Roll the API instances (rolling restart, not simultaneous — `buildServer`
   reads env once at boot, so each instance picks up the new token on its
   own restart cycle). Both old and new tokens are valid during the roll.
4. Once every instance is confirmed on the new token (check `/ready` and
   send a canary OTP or notification), revoke the OLD system-user token in
   Meta Business Manager.
5. Confirm revocation: a request signed with the old token now returns
   `401`/`403` from the Graph API (the adapter surfaces this as a delivery
   failure, which the notification sender retries with backoff and the OTP
   path falls back to SMS per MM-DEC rev02 §8 — no user-facing outage during
   a clean rotation).

## Production guardrail interaction

If `WHATSAPP_ACCESS_TOKEN` or `WHATSAPP_PHONE_NUMBER_ID` is ever unset (e.g.
a rotation script clears the var before setting the new value, or a
misconfigured deploy), `buildServer` in `apps/api/src/app.ts` falls back to
the mock WhatsApp adapter. In `NODE_ENV=production` this is refused at boot
— the app raises `Refusing to boot in production with a mock adapter
wired: identity OTP whatsapp channel` (or `communication whatsapp
channel`) rather than silently serving from the mock. See
`apps/api/test/mock-production-guard.test.ts`. Never rotate by unsetting
the old value before the new one is deployed on the SAME env write.
