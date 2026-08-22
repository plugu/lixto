---
id: 15
status: done
model: sonnet
depends_on: [13]
max_attempts: 3
files:
  - web/lib/analise-queries.ts
  - web/lib/queries.ts
  - web/lib/queries.test.ts
  - web/app/licitacoes/page.tsx
  - web/components/fit-badge.tsx
  - web/components/analise-panel.tsx
  - web/app/licitacao/[numeroControle]/page.tsx
---
## Goal
Surface agent verdicts in the web UI: fit badge + fit filter on `/licitacoes`, full analysis panel on the licitação detail page.

## Context
Schema: `analise` table from ticket 13 (`fit_score`, `verdict`, `reasoning`, `deep_verdict`, `requirements`/`prazos`/`risks` JSONB, `deep_status`, timestamps), PK `numero_controle_pncp`.

`analise-queries.ts` (new): `AnaliseRow` type + `fetchAnalise(numeroControle)` for the detail page, following `detail-queries.ts` patterns (server-only, `db.ts` pool).

`queries.ts`: add `fit?: string[]` to `LicitacaoFilters` (URL param `fit`, repeatable, values `fit|borderline|no_fit|sem_analise`); predicate via `LEFT JOIN analise a USING (numero_controle_pncp)` — `sem_analise` means `a.verdict IS NULL`, others `= ANY`. `buildListQuery` also selects `a.verdict AS fit_verdict, a.fit_score, a.deep_verdict, a.deep_status`; extend `LicitacaoRow` accordingly. Keep facet queries untouched (no fit facet counts this cycle).

`fit-badge.tsx`: small badge for list rows and detail header — shows `deep_verdict ?? verdict` + score; colors per `docs/WEB_STYLE.md` tokens (fit=green/accent, borderline=amber, no_fit=muted); nothing rendered when no analise. Add badge column to the `/licitacoes` table and a "Fit" multi-select popover to the existing filter bar (reuse `multi-select.tsx` + chips pattern from ticket 12, options with static labels, no counts).

`analise-panel.tsx`: card on the detail page (`shadow-card`, style per `docs/WEB_STYLE.md`) rendering verdict + score + reasoning, and when `deep_status='done'`: requirements table (tipo/descricao/atende), prazos list, risks list; `deep_status='skipped'|'error'` shows a short note with `error`. Panel hidden entirely when no analise row.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s "localhost:3100/licitacoes?fit=fit&fit=borderline" | grep -qi "licita" && pkill -f "next-server"`

## Done when
- `/licitacoes?fit=fit` narrows to analysed-fit rows and shows badges; a licitação analysed by tickets 13/14 shows the full panel on its detail page; licitações without analysis render unchanged.

## Not included
- No fit facet counts, no dashboard changes, no re-run/trigger buttons in the UI, no profile editing UI. No changes to Python code.
