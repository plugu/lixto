-- Dev-only fixture (cycle 30, ticket 172). Idempotent. Never run against prod.
--
-- Simulates `lixto results sync` finding a winning result for company 1 on
-- its latest case's procurement (case-outcome-fixture-1.sql must run first,
-- and a batch pass in between to open the results queue): inserts one
-- procurement_results row on the procurement's lowest item number with
-- supplier_tax_id = companies.tax_id (company 1), then stamps every item of
-- the procurement as synced — so fetchOutcomeEvidence sees full coverage and
-- decideOutcome (lib/case-outcome.ts) resolves the case to "won".
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO procurement_results (
    procurement_id, item_number, sequence,
    supplier_tax_id, supplier_name, awarded_unit_price, result_date
)
SELECT c.procurement_id,
       (SELECT min(i.item_number) FROM procurement_items i WHERE i.procurement_id = c.procurement_id),
       1,
       (SELECT tax_id FROM companies WHERE id = 1),
       'Fixture',
       10,
       current_date
  FROM cases c
 WHERE c.company_id = 1
 ORDER BY c.id DESC
 LIMIT 1
ON CONFLICT (procurement_id, item_number, sequence) DO NOTHING;
UPDATE procurement_items
   SET results_synced_at = now()
 WHERE procurement_id = (SELECT procurement_id FROM cases WHERE company_id = 1 ORDER BY id DESC LIMIT 1);
COMMIT;
