-- Dev-only fixture (cycle 30, ticket 172). Idempotent. Never run against prod.
--
-- Drives company 1's latest case (scripts/dev/case-fixture.sql +
-- `lixto cases run`, ticket 168) into "decided, submitted, session three
-- days ago" — past RESULTS_DELAY_DAYS (lib/case-outcome.ts, 2 days) and
-- never requested — so the next batch pass opens the PNCP results queue for
-- it. Also resets that procurement's items and clears any previous results,
-- so this fixture (and case-outcome-fixture-2.sql after it) can be rerun
-- from a clean slate.
\set ON_ERROR_STOP on
BEGIN;
UPDATE cases
   SET status = 'decided',
       decision = 'submit',
       decided_by = 1,
       decided_at = now(),
       session_at = now() - interval '3 days',
       results_requested_at = NULL,
       outcome = NULL,
       outcome_source = NULL,
       outcome_at = NULL
 WHERE id = (SELECT id FROM cases WHERE company_id = 1 ORDER BY id DESC LIMIT 1);
UPDATE procurement_items
   SET results_requested_at = NULL,
       results_synced_at = NULL
 WHERE procurement_id = (SELECT procurement_id FROM cases WHERE company_id = 1 ORDER BY id DESC LIMIT 1);
DELETE FROM procurement_results
 WHERE procurement_id = (SELECT procurement_id FROM cases WHERE company_id = 1 ORDER BY id DESC LIMIT 1);
COMMIT;
