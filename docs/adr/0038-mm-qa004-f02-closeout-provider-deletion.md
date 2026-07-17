# ADR-0038 — MM-QA-004 F-02 close-out: provider self-deletion retires the directory listing

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).
Implements the code fix spec'd in ADR-0034's provider-deletion
disposition — the disposition itself (self-service kept for providers)
remains a delegated ruling pending owner ratification.

## Context

`identity.deleteAccount` (Slice 3a, ADR-0033) is role-agnostic. For a
provider, the Better Auth user delete CASCADEs `provider_profiles` away —
but the directory module mirrors approval/visibility state only from
`identity.provider_status_changed.v1` events, and a cascade emits no
event. An approved, publicly-listed doctor who self-deleted would leave
a dangling public listing: `providers.approved` true,
`doctor_profiles.publiclyVisible` true, still visible and bookable with
no account behind it (verified in code; ADR-0034 records the gap).

## Decision

- **`identity.account_deleted.v2`** adds `providerProfileId: string |
null` — still id-only (the F-04 posture). v2 rather than an edit of
  the shipped v1: the ADR-0032 owner ruling ("shipped contract versions
  are never edited") is read conservatively to cover additive edits too.
  v1 stays registered for rows already emitted; the emit site
  (`delete-account.ts`) now emits v2, reading the caller's
  `provider_profiles` row (identity-owned) inside the same transaction,
  before the post-commit Better Auth delete cascades it away.
- **Communication** registers its existing prune handler for v1 AND v2
  (old handlers kept until drained, convention #3); the prune keys off
  the ids both versions carry.
- **Directory** gains `directory.retire-deleted-provider` on v2: when
  `providerProfileId` is non-null, set the mirrored `providers.approved`
  false and recompute denormalized visibility — the exact mechanism of
  `directory.sync-provider-approval` — on the handler's
  idempotency-claimed transaction. The visibility recompute re-emits
  `directory.*_updated.v1`, so the search read model retires the listing
  through its existing subscription.

## Tests (convention #12)

- Contracts: event-set pin updated to 10; v2 parse cases (nullable
  provider id, missing field rejected); the no-PII schema test covers v2
  automatically.
- API (`delete-account.test.ts`): patient-flow matrix assertion updated
  to the v2 payload (`providerProfileId: null`); new test seeds an
  approved, publicly-visible doctor, self-deletes, and asserts the v2
  event carries the provider profile id, `provider_profiles` is
  cascaded away, and the listing retires (`approved` false,
  `publiclyVisible` false) via the outbox — red-proven by unregistering
  the directory subscriber (waitFor timeout) and restoring it.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
965 tests / 131 files, zero failed · build 3/3 — the Slice 3b
post-slice gate on the tree that squash-merged verbatim to main
`b1459a5` (CI verified green, run 29621174781).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
967 tests / 131 files, zero failed · build 3/3 (contracts + api gain
the v2 and retirement cases).
