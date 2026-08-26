---
id: 94
status: doing
model: sonnet
depends_on: [91]
max_attempts: 3
files:
  - web/lib/agent/tools.ts
  - web/lib/agent/tools.test.ts
  - web/lib/agent/run.ts
  - web/lib/agent/run.test.ts
---
## Goal
The chat can answer "quais oportunidades você achou hoje?" and "por que essa?" from the persisted opportunities/recommendations.

## Context

Read `PRODUCT.md` §4 and the existing tool layer (`web/lib/agent/tools.ts`: `TOOL_DEFINITIONS`, `executeTool`, validation helpers, `ProcurementRef` mapping; `run.ts`: `SYSTEM_PROMPT`). Data: `listOpportunities`, `getOpportunity` (`web/lib/opportunity-queries.ts`, ticket 90; rows carry `verdict`/`rationale` from 91). Company id only from `ToolContext`. Tests mock `../opportunity-queries` like the other query modules.

- Tool `list_opportunities` — args `{ view?: "attention"|"all"|"dismissed"; limit?: number }` (default attention, limit 1..20) → `listOpportunities(ctx.companyId, …)`; `data` = compact list `{source_id, score, verdict, closes_at, description}`; `refs` = `ProcurementRef[]` with `score`/`reasons`.
- Tool `explain_opportunity` — `{ source_id }` → `getOpportunity(ctx.companyId, sourceId)`; `data` = score, reasons (code + detail), verdict + rationale (or "sem recomendação ainda"), state; one ref. Not found → `{ ok:false, error:"oportunidade não encontrada" }`.
- `SYSTEM_PROMPT`: add one sentence — for "o que você encontrou hoje / oportunidades / por que essa" use `list_opportunities` / `explain_opportunity`; the daily digest is the source of truth for "hoje".
- Tests: both tools, validation, company id from ctx, prompt mentions the tool names.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`

## Done when
- `executeTool("list_opportunities", {}, ctx)` returns refs with scores; `explain_opportunity` returns rationale when a recommendation exists.

## Not included
- UI (93); new tools beyond these two.
