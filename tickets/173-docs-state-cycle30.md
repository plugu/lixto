---
id: 173
status: done
model: haiku
depends_on: [170, 171, 172]
max_attempts: 3
files:
  - README.md
  - docs/ARCHITECTURE.md
  - docs/DATA_MODEL.md
  - docs/VISION.md
  - CLAUDE.md
  - STATE.md
---
## Goal
Docs, schedule table, CLAUDE.md map and STATE.md describe the case agent exactly as built in 168–172, and the knowledge graph is refreshed.

## Context
Facts to document (all from the shipped tickets): tables `cases` and `case_checks` (`migrations/008_cases.sql`; the migration also widens the email template CHECK with `case_ready`); pure verdict rules in `web/lib/case-verdict.ts` (nine ordered regex rules → `DocumentKind`; statuses met / expiring / missing / manual; session date precedence dossier `session` → dossier `proposal_deadline` → `procurements.proposal_closes_at`); batch `web/lib/case-batch.ts` (`agent_runs.kind = 'cases'`; steps: create from latest GO recommendation on an open procurement → compute or enqueue analysis → `case_ready` email per admin → request item results `RESULTS_DELAY_DAYS = 2` after the session for `submit` cases → resolve won/lost from `procurement_results` (winner tax id vs `companies.tax_id`), operator may set disqualified); route `POST /api/internal/cases/run`; CLI `lixto cases run [--company-id]`; pages `/cases`, `/cases/[id]`, `/cases/[id]/bundle` (zip via `fflate`); decision → `opportunity_feedback` (`skip` → rejected + opportunity dismissed; `submit` → participated; outcome → won/lost/disqualified). Dev fixtures under `scripts/dev/` (never prod). Zero LLM spend in the whole loop.

### Work
1. `README.md`: CLI reference — add `uv run lixto cases run` next to the results command with one line each; "Production Schedules" table — add `| cases-run | `45 8,20 * * *` | `lixto cases run` | no | Enabled (after recommend-run; requires results-sync for outcomes) |` and change the `results-sync` row status to `Enabled (case outcomes; demand queue only)`; a short "Dev fixtures" note under the quick start pointing at `scripts/dev/case-fixture.sql` and the two outcome fixtures, marked dev-only.
2. `docs/ARCHITECTURE.md`: new section `## Case agent (Cycle 30)` right after "Tender Analysis (Cycle 25)": pipeline, tables, verdict rules summary, batch steps, constants, route + CLI, cost note. In "Not Built Yet": Prepare/Execute → "partial (cycle 30): case verdict, document bundle, one decision; portal submission not built"; Learning loop → "outcome capture built (cycle 30); ranking changes not built".
3. `docs/DATA_MODEL.md`: new `## Cases (Cycle 30)` after the Tender Analysis block with `### \`cases\`` and `### \`case_checks\`` in the existing format (Key / Notable columns / Notable indexes / Purpose); mention `case_ready` where email templates are listed, if they are.
4. `docs/VISION.md` appendix: add `### Cycle 30 — Case agent V1 (built)` with a bullet list; update the "Not built" rows for Prepare/Execute and Learning loop to partial with a pointer to the cycle 30 section.
5. `CLAUDE.md`: Key Code Locations — add rows `Case agent | web/lib/case-batch.ts, web/lib/case-verdict.ts, web/lib/case-queries.ts; routes web/app/(app)/cases/*; CLI src/lixto/cli/cases.py; schema migrations/008_cases.sql`; schedules list — add `cases-run — 45 8,20 * * *` and mark `results-sync` enabled (case outcomes). No new env vars.
6. `STATE.md`: rewrite (≤30 lines, never append): Now = cycle 30 (case agent V1, mvp) 168–173 done, awaiting the mvp approval 2 of 2 + deploy; Next = deploy (`lixto db init` runs on `lixto-cli` deploy), enable `cases-run` and `results-sync` in Dokploy, never run `scripts/dev/*.sql` in prod, concierge check with a real GO case; carry over the still-open items from the current STATE.md (162/167 follow-ups, DMARC, Gemini billing, Radar schedules off); Decisions = zero LLM per case, opportunity state untouched except `skip` → dismissed, `RESULTS_DELAY_DAYS = 2`.
7. Run `graphify update .` (AST-only) so `graphify-out/` reflects the new modules.

## Checks (run in order — cheapest first)
1. `grep -q 'cases-run' README.md && grep -q 'lixto cases run' README.md && grep -q 'scripts/dev/case-fixture.sql' README.md`
2. `grep -q 'Case agent (Cycle 30)' docs/ARCHITECTURE.md && grep -q 'case_checks' docs/DATA_MODEL.md && grep -q 'Cycle 30' docs/VISION.md`
3. `grep -q 'case-batch.ts' CLAUDE.md && grep -q 'cases-run' CLAUDE.md`
4. `test "$(wc -l < STATE.md)" -le 30 && grep -q 'Cycle 30' STATE.md`
5. `graphify update . > /dev/null && test -f graphify-out/GRAPH_REPORT.md`
6. `cd web && npm run lint && npx tsc --noEmit`

## Done when
- All six checks green and every statement in the new docs matches the code of 168–172 (no planned-but-unbuilt feature described as built).

## Not included
- ADRs; marketing or landing copy changes (the FAQ line about sending proposals is a separate product decision); changes to any code file.
