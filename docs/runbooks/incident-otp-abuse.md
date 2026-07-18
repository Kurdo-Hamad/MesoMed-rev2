# Runbook — incident: OTP abuse spike (MM-QA-004 Slice 4, ADR-0037)

**Severity: SEV2** (spend/abuse — eventual-path degradation and cost, not
the booking/clinical write path). Escalates toward SEV1 only if the
response itself (killing both OTP channels) takes registration/login down —
weigh that before flipping switches. Every guard below is fail-closed and
already enforced in code (`apps/api/src/kernel/abuse.ts`); this runbook is
about _tightening_ them live.

## 1. Detection signal

- **`abuse_alerts` rows** (`packages/db/src/schema/kernel.ts` — kinds
  `velocity`, `budget_alarm`, `budget_exhausted`; written by
  `recordVelocity` / `checkAndSpendBudget` in `kernel/abuse.ts`):

  ```sql
  select kind, channel, key, details, created_at from abuse_alerts
    order by created_at desc limit 50;
  ```

- Spend acceleration in today's counters and the send-rate ledger:

  ```sql
  select * from channel_spend where day = current_date;
  select scope, key, count(*) from send_rate_events
    where sent_at > now() - interval '1 hour'
    group by scope, key order by count(*) desc limit 20;
  select normalized_phone, count(*) from otp_send_attempts
    where sent_at > now() - interval '1 hour'
    group by 1 order by 2 desc limit 20;
  ```

- `mesomed_notifications_sent_total` rate spike on whatsapp/sms; provider
  console spend graphs.

## 2. First 15 minutes

All controls are `config_entries` rows validated by `packages/config`
schemas, live within the 30s config cache TTL
(`apps/api/src/kernel/config.ts`) — no deploy. Apply in this order,
least-destructive first:

1. **Tighten the per-phone OTP limit** — key `identity.otpSendPolicy`
   (`apps/api/src/modules/identity/otp-sender.ts`; default
   `{maxSends: 5, windowSeconds: 3600}`):

   ```sql
   insert into config_entries (key, value)
   values ('identity.otpSendPolicy', '{"maxSends": 2, "windowSeconds": 3600}')
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```

2. **Tighten per-IP / per-device windows** — key
   `communication.send_rate_policy` (defaults ip/device 15 per hour,
   `DEFAULT_SEND_RATE_POLICY`, `packages/config/src/index.ts`):

   ```sql
   insert into config_entries (key, value)
   values ('communication.send_rate_policy',
           '{"ip": {"maxSends": 5, "windowSeconds": 3600},
             "device": {"maxSends": 5, "windowSeconds": 3600}}')
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```

3. **Cap the bleeding with budgets** — key `communication.channel_budgets`:
   at `alarmAt` an alert row is written, at `dailyLimit` sends are refused
   (`checkAndSpendBudget`):

   ```sql
   insert into config_entries (key, value)
   values ('communication.channel_budgets',
           '{"whatsapp": {"dailyLimit": 500, "alarmAt": 300},
             "sms": {"dailyLimit": 500, "alarmAt": 300}}')
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```

4. **Allowlist** — key `communication.destination_countries` (fail-closed,
   Iraq-only default `{"IQ": {"prefixes": ["+964"]}}`,
   `resolveDestinationCountry`). If the abuse traffic somehow carries
   non-`+964` destinations, the allowlist is already refusing it — check
   `denied` outcomes before assuming it isn't.
5. **Kill switch — last resort** — key `communication.channel_kill_switch`
   (`assertChannelEnabled`). Killing `whatsapp` shifts OTP to the SMS
   fallback (`otp-sender.ts`); killing **both** stops OTP delivery
   entirely (`OTP_DELIVERY_FAILED`) — that is a deliberate
   registration/login outage. Same SQL shape as above with
   `'{"whatsapp": true, "sms": true}'`.

## 3. Escalation

Owner-responder. Report confirmed pumping fraud to the provider (Twilio/
Meta have SMS-pumping abuse teams — reference the destination numbers from
`otp_send_attempts`). **Known gap, do not improvise around it:** there is
no per-number or per-IP _blocklist_ mechanism — the allowlist is
country-granular and `communication.velocity_policy` only writes alert
rows, never blocks (`recordVelocity` "a hook, never a gate"). If one
in-country number range must be blocked persistently, that is a named
slice + ADR, not a hand-edit.

## 4. Verification of recovery

- `abuse_alerts` quiet (no new `velocity`/`budget_*` rows in the last hour);
  the §1 queries show per-key counts back under the defaults.
- `channel_spend` for today flat; provider console spend curve flattened.
- Legitimate flow intact: one real OTP round-trip on the owner's test
  device succeeds within the tightened limits.
- **Restore the tightened policies** once the spike subsides — the
  defaults exist because ordinary users hit them (delete the override row
  or write the default values back); leave the episode's numbers, the
  config values used, and the total spend in the SEV2 postmortem for the
  risk register.
