-- MM-QA-004 F-11 (ADR-0045): bound every statement, lock wait, and
-- idle-in-transaction session for the production API role. No timeout
-- existed at any layer; a wedged query or abandoned transaction could
-- hold locks indefinitely. Values are the ADR-0045 delegated ruling
-- (owner ratification pending): generous multiples of the slowest
-- legitimate API query, far below incident-visibility thresholds.
-- Role-level GUCs apply at login for sessions authenticating AS
-- mesomed_api; migrations and admin tooling authenticate as the
-- database owner and are unaffected. The API's pool additionally sets
-- the same values as connection parameters (packages/db client factory,
-- wired in the composition root) so the bounds hold even where
-- DATABASE_URL uses a different role. Ships as a NEW migration file
-- (F-21 rule) — shipped migrations are never edited.
-- ALTER ROLE mutates a CLUSTER-wide shared catalog; concurrent migrators
-- on separate databases of one server (parallel test files on the CI pg
-- service — the ADR-0022 class) race to "tuple concurrently updated".
-- An advisory lock cannot fix this: the migrator wraps its whole batch in
-- one transaction, so a waiter's snapshot predates the lock and its
-- catalog update still sees the older tuple version. Instead, the 0004
-- philosophy: the values are idempotent — the first committer wins, and a
-- loser's "tuple concurrently updated" means the identical settings were
-- already applied, so it is swallowed (that exact error only; anything
-- else raises).
DO $$
BEGIN
  ALTER ROLE mesomed_api SET statement_timeout = '10s';
  ALTER ROLE mesomed_api SET lock_timeout = '5s';
  ALTER ROLE mesomed_api SET idle_in_transaction_session_timeout = '30s';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM <> 'tuple concurrently updated' THEN
      RAISE;
    END IF;
END
$$;
