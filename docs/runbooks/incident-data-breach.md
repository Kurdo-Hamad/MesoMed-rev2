# Runbook — incident: suspected data breach (MM-QA-004 Slice 4, ADR-0037)

**Severity: SEV1** — a health-data platform; suspected PII/clinical
exposure outranks availability. Sequence per MM-ARC-002 §10.9: freeze
support-access grants → snapshot the audit log → rotate keys → work the
notification-obligations checklist. Preserve evidence before changing
state wherever the two conflict.

## 1. Detection signal

- Sentry: authz anomalies, unexpected admin-procedure activity.
- `clinical_access_log` (append-only, populated by SECURITY DEFINER
  triggers/read functions — `packages/db/src/schema/clinical.ts`,
  convention #5): unexplained `support_notes_read` / `grant_created`
  actions, or reads by an unexpected `actor_user_id`.
- Provider-side signals: vendor abuse notices, leaked-credential alerts
  (GitHub secret scanning, CI gitleaks — ADR-0025), unexplained spend.
- `abuse_alerts` velocity anomalies coinciding with credential use.

## 2. First 15 minutes

1. **Freeze support-access grants.** The audited per-grant path is the
   admin procedure `clinical.revokeSupportAccess`
   (`apps/api/src/modules/clinical/router.ts`, command in
   `modules/clinical/commands/support-access.ts` — emits
   `clinical.support_access_revoked.v1`). In a breach, freeze ALL active
   grants at once with SQL (the DB re-checks grants at read time, so this
   cuts access immediately; note it bypasses the per-grant revoked event —
   record that in the timeline):

   ```sql
   update support_access_grants
      set revoked_at = now()
    where revoked_at is null and expires_at > now();
   ```

   Do not create new grants until the incident closes (grant creation is
   `roleProcedure("admin")` — if an admin account is the suspect, revoke
   its sessions via the identity module first).

2. **Snapshot the audit trail** — before anything else changes it.
   `clinical_access_log` is append-only (UPDATE/DELETE trigger-blocked,
   superuser included), but snapshot anyway for offline forensics:

   ```sh
   pg_dump "$DATABASE_URL" --data-only --format=custom \
     --table=clinical_access_log --table=support_access_grants \
     --table=abuse_alerts \
     --file=breach-audit-$(date +%Y%m%dT%H%M).dump
   ```

   Store the dump OFF the affected infrastructure. Record who took it and
   when.

3. **Rotate keys** — every adapter secret, per the four rotation runbooks
   (each is zero-downtime and documents its blast radius):
   - `docs/runbooks/secrets-rotation-anthropic.md`
   - `docs/runbooks/secrets-rotation-meta-whatsapp.md`
   - `docs/runbooks/secrets-rotation-resend.md`
   - `docs/runbooks/secrets-rotation-twilio-sms.md`

   Additionally rotate the credentials those runbooks do NOT cover (no
   dedicated runbook exists — provider-console work): the `DATABASE_URL`
   role password (managed-PG console; then re-run
   `pnpm --filter @mesomed/api verify:db-role`, ADR-0027),
   `BETTER_AUTH_SECRET` (env schema `apps/api/src/env.ts`; rotating it
   invalidates sessions — that is desirable mid-breach), and the Grafana
   OTLP token (HG-2 step 2).

## 3. Escalation

Owner-responder and owner-decider — containment beyond the steps above
(taking the API offline, forced logout of all users) is an owner call:
weigh SEV1 clinical availability against exposure. If the suspected vector
is platform-side (Railway/Fly, Vercel, managed PG, Supabase-hosted
anything), open a security ticket with that provider immediately. Legal
review is owner-procured — legal conclusions are owner-approved, never
self-certified (same principle as MM-QA-004 Slice 3b).

## 4. Verification of recovery — notification obligations checklist

- [ ] Scope established from evidence: which tables/rows were reachable
      (PII inventory = the erasure matrix in
      `docs/runbooks/data-retention-erasure.md` §1 — `patient_profiles`,
      `notification_log`, `send_rate_events`, `abuse_alerts`,
      clinical tables, Better Auth `user`/session tables).
- [ ] Timeline written from `clinical_access_log`, pino logs, Sentry, and
      provider access logs, against the snapshot from §2.
- [ ] Legal basis note: Iraq has no GDPR-equivalent statute today
      (`data-retention-erasure.md` §1), but the platform is engineered to
      GDPR-like semantics — the owner decides, with legal review, whether
      and how to notify affected patients/providers; record the decision
      and its rationale even if the decision is "no external notification".
- [ ] Affected users notified through the communication module where
      ruled necessary; store/platform obligations (Apple/Google data-safety
      declarations) reviewed if account data was exposed.
- [ ] All rotated credentials confirmed live (each rotation runbook's own
      verification step) and old credentials confirmed dead.
- [ ] Support-access grants: frozen set reviewed; legitimate grants
      re-issued through `clinical.grantSupportAccess` (time-boxed,
      reasoned) — never by SQL.
- [ ] SEV1 blameless postmortem; risk register updated; if the vector was
      an API-layer bug, the fix lands as a named slice with a test that
      reproduces the vector (convention #12).
