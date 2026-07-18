# Runbook — incident: notification provider outage (MM-QA-004 Slice 4, ADR-0037)

**Severity: SEV2** — notifications are an eventual path (MM-ARC-002 §10.9:
degraded eventual paths). Bookings keep committing. Exception: a
WhatsApp **and** SMS outage together takes OTP delivery down, which blocks
registration/login — treat that combination as SEV1-adjacent and say so in
the postmortem. Providers: Meta WhatsApp, Twilio SMS, Resend email, Expo
push (`packages/platform`).

## 1. Detection signal

- `mesomed_notifications_sent_total{status="failed"}` climbing for one
  channel (counter from `recordNotificationSend`,
  `apps/api/src/kernel/metrics.ts`; channel-mix on the booking-funnel /
  dead-letter dashboards).
- Sender logs: `"whatsapp notification failed, falling back to sms"` /
  adapter timeout errors (`apps/api/src/modules/communication/sender.ts`;
  adapters bound vendor calls to 10s, ADR-0011 F-3).
- Backlog in the notification outbox:

  ```sql
  select channel, status, count(*) from notification_log
    where created_at > now() - interval '2 hours'
    group by channel, status order by channel;
  select channel, left(last_error, 200), count(*) from notification_log
    where status in ('pending', 'failed') and attempts > 0
    group by 1, 2 order by count(*) desc limit 10;
  ```

- Provider status pages (Meta, Twilio, Resend, Expo) confirm.

## 2. First 15 minutes

1. Confirm it is the provider, not our credentials: a 401/403 in
   `last_error` right after a rotation points at the rotation, not an
   outage — see the matching `docs/runbooks/secrets-rotation-*.md`.
2. Know the automatic behavior before intervening:
   - WhatsApp rows fall back to SMS inline (`sender.ts`, mirrors OTP order
     MM-DEC rev02 §8) — a WhatsApp-only outage mostly degrades to SMS cost.
   - Failed sends retry with backoff `60s × attempts` up to **5 attempts,
     then the row goes `failed` — terminal** (`sender.ts`,
     `DEFAULT_MAX_ATTEMPTS`/`DEFAULT_BACKOFF_SECONDS`). **An outage longer
     than ~15 minutes therefore does NOT fully drain by itself** — plan the
     §4 redrive.
3. **Kill switch — the real mechanism.** One config row,
   `communication.channel_kill_switch`
   (`CHANNEL_KILL_SWITCH_CONFIG_KEY`, `packages/config/src/index.ts`;
   enforced fail-closed by `assertChannelEnabled`,
   `apps/api/src/kernel/abuse.ts`), takes effect within the 30s config
   cache TTL (`apps/api/src/kernel/config.ts`) — no deploy:

   ```sql
   insert into config_entries (key, value)
   values ('communication.channel_kill_switch', '{"whatsapp": true}')
   on conflict (key) do update
     set value = excluded.value, updated_at = now();
   ```

   **Use it deliberately, knowing its semantics:** a killed channel's rows
   are marked `denied` (`denied_reason = 'CHANNEL_DISABLED'`) — **terminal,
   not queued** (`markDenied`, `sender.ts`). Kill a channel to stop
   burning spend/attempts on a hard outage (or to force WhatsApp traffic
   onto SMS via the inline fallback); do NOT kill it expecting the rows to
   send later by themselves — un-killing requires the §4 redrive to
   deliver what was denied meanwhile.

4. Watch spend on the fallback channel: SMS costs real money —
   `communication.channel_budgets` caps it (`checkAndSpendBudget`,
   `kernel/abuse.ts`; today's counters in `channel_spend`).

## 3. Escalation

Owner-responder; provider support ticket with request IDs from the adapter
errors. If both OTP channels (whatsapp + sms) are down, OTP delivery fails
closed (`otp-sender.ts` — `OTP_DELIVERY_FAILED` after the SMS fallback):
announce degraded registration/login and prioritize whichever provider
recovers first. Rotating to backup credentials follows the four
`secrets-rotation-*` runbooks.

## 4. Verification of recovery

1. Clear the kill switch (write `{"<channel>": false}` or remove the entry
   — absent means enabled, `resolveChannelKilled`).
2. **Drain the stranded rows** — pending rows send automatically (5s poll),
   but `failed` (retries exhausted) and `denied` (kill switch) rows are
   terminal and there is **no built-in redrive**; manual SQL is the
   mechanism. The unique `dedupe_key` stays intact, so this cannot
   double-plan:

   ```sql
   update notification_log
      set status = 'pending', attempts = 0, next_attempt_at = now(),
          last_error = null, denied_reason = null, updated_at = now()
    where channel = '<channel>'
      and status in ('failed', 'denied')
      and denied_reason is distinct from 'sms_disabled_by_preference'
      and created_at > '<outage start>';
   ```

   (Never redrive `sms_disabled_by_preference` denials — that is a consent
   decision, ADR-0011 F-4, not an outage artifact. Skip stale reminders
   whose appointment time has passed — check `appointment_id` relevance
   before bulk redrive.)

3. Verify: `status='sent'` counts rising, `failed`/`denied` flat,
   `mesomed_notifications_sent_total{status="sent"}` recovering, one test
   notification received on the probe phone. SEV2 postmortem with the
   spend number.
