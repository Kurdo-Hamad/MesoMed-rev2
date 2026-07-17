# Runbook — data retention & erasure procedure (Phase 10 Slice 6, ADR-0028)

Ruled scope (D7 = option B, MM-DES-003 §8.1): this document + the
automated retention prune job. The crypto-shred mechanism is **designed
here but deliberately not built** (no compliance driver at launch,
~zero data volume; pre-launch retrofit stays cheap because the design
is recorded).

## 1. Retention & erasure matrix

| Table                                          | Contains                                                                                                                                                                                                                                                                                                                          | Retention                                         | Erasure on subject request                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `patient_profiles`                             | name, normalized phone                                                                                                                                                                                                                                                                                                            | life of account/profile                           | anonymize row (NULL name/phone, keep id for referential integrity) after clinical hold check                            |
| `appointments`                                 | booking facts (id-linked)                                                                                                                                                                                                                                                                                                         | operational history                               | keep (pseudonymous once profile anonymized)                                                                             |
| `encounters` / `visit_notes` / `prescriptions` | clinical record                                                                                                                                                                                                                                                                                                                   | medical-records obligation (jurisdiction-defined) | **never deleted; corrections are amendments (convention #5).** Conflict resolved by crypto-shred design (§3) when built |
| `clinical_access_log`                          | audit trail (append-only, DB-enforced)                                                                                                                                                                                                                                                                                            | permanent                                         | crypto-shred design (§3) — the audit row survives, the PII inside it becomes unrecoverable                              |
| `notification_log`                             | destination, params_json, appointment_id (PII)                                                                                                                                                                                                                                                                                    | **540 days, automated prune (§2)**                | hard-delete rows for the subject (`patient_profile_id` / `user_id` match) — allowed, not audit data                     |
| `send_rate_events`                             | phone/IP keys (PII)                                                                                                                                                                                                                                                                                                               | **7 days, automated prune (§2)**                  | window expiry IS the erasure; on-demand: delete by key                                                                  |
| `abuse_alerts`                                 | phone keys (PII)                                                                                                                                                                                                                                                                                                                  | 12–24 months (ADR-0011); manual for now           | delete/NULL `key` by subject; joins the prune job when data first approaches its window                                 |
| `device_tokens`                                | Expo push tokens                                                                                                                                                                                                                                                                                                                  | until invalid (sender auto-deletes) or logout     | delete rows for the user                                                                                                |
| `user` / auth tables (Better Auth)             | email, name, sessions                                                                                                                                                                                                                                                                                                             | life of account                                   | account deletion flow (identity module)                                                                                 |
| `domain_events`                                | event payloads — **NOT id-only today**: identity v1 events carry PII (`identity.user_registered.v1` phone/email, `identity.patient_profile_created.v1` normalizedPhone); booking snapshots are id-only. Remediation in flight — see MM-QA-004 F-04 slice (v2 id-only identity events + redaction migration over existing v1 rows) | operational history                               | keep — pseudonymous only once the F-04 redaction migration lands; until then identity v1 payloads retain phone/email    |

Legal basis at launch: consent (booking requires phone contact) +
legitimate operational interest for abuse/audit data; Iraq has no
GDPR-equivalent statute today — the matrix is engineered to GDPR-like
erasure semantics anyway, because retrofitting is what's expensive.

## 2. Automated retention prune (built in this slice)

pg-boss cron `data-retention-prune` (default `30 2 * * *`), registered
in the composition root next to the reminder job:

- `pruneNotificationLog(db, RETENTION_NOTIFICATION_LOG_DAYS)` — default
  540 days (inside the ADR-0011 12–24-month band); deletes ALL statuses
  past the window (a pending row must not outlive its retention).
- `pruneSendRateEvents(db, RETENTION_SEND_RATE_EVENTS_DAYS)` — default
  7 days, per the schema's own "days, not months" comment.

Env knobs: `RETENTION_CRON`, `RETENTION_NOTIFICATION_LOG_DAYS`,
`RETENTION_SEND_RATE_EVENTS_DAYS`. Each run logs deleted counts.

## 3. Crypto-shred design (recorded, NOT built — D7 option B)

For PII inside immutable/audit data (`clinical_access_log`, the
clinical record, and the ADR-0011-annotated columns if ever required):

- A `pii_keys` table: one AES-256-GCM data key per subject
  (`patient_profile_id`), itself encrypted by a KMS-held master key.
- Annotated columns store ciphertext (`enc:v1:<iv>:<tag>:<data>`);
  reads decrypt through a kernel helper that resolves the subject key.
- **Erasure = deleting the subject's `pii_keys` row.** Every ciphertext
  everywhere — including audit rows and inside old backups once they
  expire — becomes unrecoverable. Erasure is complete when the last
  backup containing the key expires (bound backup retention
  accordingly; see `backup-restore.md`).
- Build trigger: a compliance driver, a jurisdictional requirement, or
  the first real erasure request that hits audit-immutable data —
  whichever comes first. Costs when built: kernel key service, write-path
  changes in communication/abuse/clinical, one migration.

## 4. Handling an erasure request (manual procedure, today)

1. Verify subject identity (phone OTP through the normal identity flow).
2. Check for a clinical hold (encounters exist → clinical record is
   retained under §1; only the non-clinical rows below are actioned).
3. Run, in one transaction: anonymize `patient_profiles` row; delete
   `notification_log` / `device_tokens` / `send_rate_events` /
   `abuse_alerts` rows keyed to the subject's phone/profile/user id.
4. Record the request + completion date (append an entry to ADR-0028).
5. Note the backup horizon: deleted data persists in backups until
   their retention expires — state that window in the confirmation.
