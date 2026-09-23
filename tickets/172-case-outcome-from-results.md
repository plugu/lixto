---
id: 172
status: done
model: sonnet
depends_on: [169, 171]
max_attempts: 3
files:
  - web/lib/case-outcome.ts
  - web/lib/case-outcome.test.ts
  - web/lib/case-queries.ts
  - web/lib/case-queries.test.ts
  - web/lib/case-batch.ts
  - web/lib/case-batch.test.ts
  - web/lib/tenant-isolation.test.ts
  - web/components/case-outcome.tsx
  - web/app/(app)/cases/[id]/page.tsx
  - web/app/(app)/cases/[id]/actions.ts
  - web/app/(app)/cases/[id]/actions.test.ts
  - scripts/dev/case-outcome-fixture-1.sql
  - scripts/dev/case-outcome-fixture-2.sql
---
## Goal
After the session, a case answered **Vou enviar** gets its items queued for PNCP results; once results land, the case shows **Ganhou** or **Perdeu** (feedback row written), and the operator can correct it to **Desclassificado**.

## Context
Results are demand-driven (`src/lixto/sync/results.py`): items with `procurement_items.results_requested_at IS NOT NULL AND results_synced_at IS NULL` are fetched by `lixto results sync` into `procurement_results` (`supplier_tax_id` = `niFornecedor`, may carry punctuation; `cancelled_at` set on cancelled results; `results_synced_at` is stamped even when the array is empty). Companies: `companies.tax_id` is 14 digits. Feedback kinds `won|lost|disqualified` already exist in `opportunity_feedback` (`user_id` nullable). Case reads/writes: `web/lib/case-queries.ts` (168/170); batch: `web/lib/case-batch.ts`; decision action + page: ticket 169 (`decideCaseAction`, `CaseDecision`). In `actions.test.ts`, every `@/...` import of the module under test needs its own `vi.mock` (vitest resolves `@/` only for mocked ids). `insertFeedback` accepts `"disqualified"` since 169.

### Work
1. `web/lib/case-outcome.ts` (pure): `export const RESULTS_DELAY_DAYS = 2;` (documented hardcode, mvp: "results appear days after the session; earlier requests only burn PNCP calls"); `export function decideOutcome(e: {won: boolean; unsyncedItems: number; resultRows: number}): "won" | "lost" | null` — `won` → `"won"`; else `unsyncedItems === 0 && resultRows > 0` → `"lost"`; else `null`. Test the truth table.
2. `case-queries.ts`:
   - `listCasesForResultsRequest(days = RESULTS_DELAY_DAYS)` → `SELECT id, procurement_id FROM cases WHERE decision = 'submit' AND results_requested_at IS NULL AND session_at IS NOT NULL AND session_at < now() - make_interval(days => $1)`.
   - `requestItemResults(procurementId)` → `UPDATE procurement_items SET results_requested_at = now(), updated_at = now() WHERE procurement_id = $1 AND results_requested_at IS NULL AND results_synced_at IS NULL`; `stampCaseResultsRequested(caseId)`.
   - `listCasesAwaitingOutcome()` → `SELECT id, opportunity_id FROM cases WHERE decision = 'submit' AND results_requested_at IS NOT NULL AND outcome IS NULL`.
   - `fetchOutcomeEvidence(caseId)`:
     ```sql
     SELECT bool_or(r.supplier_tax_id IS NOT NULL AND regexp_replace(r.supplier_tax_id, '\D', '', 'g') = c.tax_id) AS won,
            count(*) FILTER (WHERE i.results_synced_at IS NULL) AS unsynced_items,
            count(r.procurement_id) AS result_rows
       FROM cases cs
       JOIN companies c ON c.id = cs.company_id
       JOIN procurement_items i ON i.procurement_id = cs.procurement_id
       LEFT JOIN procurement_results r ON r.procurement_id = i.procurement_id AND r.item_number = i.item_number AND r.cancelled_at IS NULL
      WHERE cs.id = $1
      GROUP BY cs.id
     ```
     (numbers via `Number`, `won` coalesced to `false`).
   - `setOutcomeFromPncp(caseId, outcome)` → `UPDATE cases SET outcome = $2, outcome_source = 'pncp', outcome_at = now(), updated_at = now() WHERE id = $1 AND outcome IS NULL`; `insertSystemFeedback(opportunityId, kind, reason)` → `INSERT INTO opportunity_feedback (opportunity_id, user_id, kind, reason) VALUES ($1, NULL, $2, $3)`.
   - Tenant builder `buildSetOutcomeByOperator(companyId, caseId)` / `setOutcomeByOperator` → `UPDATE cases SET outcome = 'disqualified', outcome_source = 'operator', outcome_at = now(), updated_at = now() WHERE id = $2 AND company_id = $1 AND decision = 'submit' RETURNING opportunity_id` (register in `tenant-isolation.test.ts`). Builder tests: interval param bound, regexp on tax id, `cancelled_at IS NULL`, operator update requires `decision = 'submit'`.
3. `case-batch.ts`: two more steps after the email step — (a) for each `listCasesForResultsRequest()`: `requestItemResults` + `stampCaseResultsRequested`, `resultsRequested++`; (b) for each `listCasesAwaitingOutcome()`: `decideOutcome(await fetchOutcomeEvidence(id))` → when non-null `setOutcomeFromPncp` + `insertSystemFeedback(opportunity_id, outcome, "pncp:results")`, `resolved++`. Per-row try/catch → `failed++`. Tests: request step stamps both; evidence `won` → outcome won + feedback; all synced & no win → lost; pending evidence → nothing written.
4. `web/components/case-outcome.tsx` (`"use client"`): props `{caseId, decision, outcome, outcomeSource, outcomeAt}`. `decision !== "submit"` → "Sem acompanhamento de resultado para esta resposta."; outcome null → "Aguardando resultado no PNCP (consultado a partir de 2 dias após a sessão)."; outcome set → `Badge` with `OUTCOME_LABELS` + "via PNCP" / "informado por você" + date. When `decision === "submit"` and `outcome !== "disqualified"`: `Button` (secondary) "Fomos desclassificados" → `markDisqualifiedAction(caseId)` in `useTransition`, toast on result.
5. `actions.ts`: `markDisqualifiedAction(caseId: number)` — `requireSession()`; `setOutcomeByOperator(companyId, caseId)` → null → `{error: "Caso não encontrado ou sem resposta 'Vou enviar'."}`; else `insertFeedback(companyId, opportunity_id, session.user.id, "disqualified", "caso:operador")`; revalidate `/cases` and `/cases/${caseId}`. Tests: happy path (feedback written), not found.
6. `[id]/page.tsx`: add a "Resultado" `Card` with `CaseOutcome` after "Sua decisão".
7. Fixtures (idempotent, dev only; both start with `\set ON_ERROR_STOP on`):
   - `scripts/dev/case-outcome-fixture-1.sql`: latest case of company 1 → `UPDATE cases SET status = 'decided', decision = 'submit', decided_by = 1, decided_at = now(), session_at = now() - interval '3 days', results_requested_at = NULL, outcome = NULL, outcome_source = NULL, outcome_at = NULL WHERE id = (SELECT id FROM cases WHERE company_id = 1 ORDER BY id DESC LIMIT 1)`; also reset that procurement's items: `UPDATE procurement_items SET results_requested_at = NULL, results_synced_at = NULL WHERE procurement_id = (SELECT procurement_id FROM cases WHERE company_id = 1 ORDER BY id DESC LIMIT 1)` and delete its `procurement_results` rows.
   - `scripts/dev/case-outcome-fixture-2.sql`: for that procurement, insert one `procurement_results` row for its lowest `item_number` with `sequence = 1`, `supplier_tax_id = (SELECT tax_id FROM companies WHERE id = 1)`, `supplier_name = 'Fixture'`, `awarded_unit_price = 10`, `result_date = current_date` (`ON CONFLICT DO NOTHING`), then `UPDATE procurement_items SET results_synced_at = now() WHERE procurement_id = …`.

Runtime probe preconditions: as ticket 169; the 168 fixture + batch must have produced the company-1 case (check 6 below reruns them).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/case-outcome.test.ts lib/case-queries.test.ts lib/case-batch.test.ts lib/tenant-isolation.test.ts 'app/(app)/cases/[id]/actions.test.ts'`
3. `cd web && npx tsc --noEmit`
4. `cd web && npm test`
5. `cd web && npm run build`
6. `docker exec -i plataforma-licitante-db-1 psql -U lixto -d lixto -q < scripts/dev/case-fixture.sql && tok=$(grep -E '^LIXTO_INTERNAL_TOKEN=' web/.env.local | cut -d= -f2- | tr -d '"') && curl -s -X POST -H "x-lixto-internal-token: $tok" localhost:3000/api/internal/cases/run | grep -q '"runId"' && docker exec -i plataforma-licitante-db-1 psql -U lixto -d lixto -q < scripts/dev/case-outcome-fixture-1.sql && curl -s -X POST -H "x-lixto-internal-token: $tok" localhost:3000/api/internal/cases/run | grep -q '"resultsRequested":1'`
7. `docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select count(*) from procurement_items i join cases c on c.procurement_id = i.procurement_id where c.company_id = 1 and c.id = (select max(id) from cases where company_id = 1) and i.results_requested_at is not null" | grep -Eq '^[1-9]'`
8. `tok=$(grep -E '^LIXTO_INTERNAL_TOKEN=' web/.env.local | cut -d= -f2- | tr -d '"') && docker exec -i plataforma-licitante-db-1 psql -U lixto -d lixto -q < scripts/dev/case-outcome-fixture-2.sql && curl -s -X POST -H "x-lixto-internal-token: $tok" localhost:3000/api/internal/cases/run | grep -q '"resolved":1' && docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select c.outcome || ':' || c.outcome_source || ':' || (select count(*) from opportunity_feedback f where f.opportunity_id = c.opportunity_id and f.kind = 'won') from cases c where c.company_id = 1 order by c.id desc limit 1" | grep -qx 'won:pncp:1'`
9. `id=$(docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select id from cases where company_id = 1 order by id desc limit 1") && curl -s -b lixto_session=devprobe localhost:3000/cases/$id | grep -q 'Ganhou'`

## Done when
- All nine checks green: items queued two days after the session, the fixture result resolves to `won` with a feedback row, and the page shows "Ganhou".

## Not included
- Enabling the `results-sync` schedule in prod (documented in 173; done by the operator in Dokploy).
- Price bands or any use of `awarded_unit_price`; learning from outcomes; outcome for `skip` / `missing_document` cases; detecting "disqualified" automatically.
