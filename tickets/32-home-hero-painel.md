---
id: 32
status: done
model: sonnet
depends_on: [31]
max_attempts: 3
files:
  - web/app/page.tsx
  - web/app/painel/page.tsx
  - web/components/charts/bar-list.tsx
  - web/components/charts/daily-line.tsx
  - web/components/charts/stat-tile.tsx
  - web/components/charts/status-stack.tsx
---
## Goal
`/` becomes a Perplexity-style hero (search + quick-filter chips + KPI strip); the current dashboard moves unchanged in function to `/painel`, restyled with the new tokens.

## Context
Read `docs/design/cycle8-direction.md` and `web/components/ui/*.tsx` (kit from ticket 31) first. Current `web/app/page.tsx` (121 lines, `force-dynamic`): escopo tabs `abertas|vai_abrir|tudo` via `?escopo=` (`parseChartScope`), imports `stats-queries` (`fetchStatusCounts`, `fetchPorModalidade`, `fetchPorPortal`, `fetchPorDia`) and the four charts.

New `/` (`page.tsx`, server, `force-dynamic`) — match the approved `Main` artboard (see `docs/design/cycle8-direction.md` "Home hero (v2)"): vertical centering in viewport minus chrome; headline `font-display` 44/48 "O que você quer saber <em className='italic text-accent'>hoje</em>?" + one muted 15px line "Pergunte em português sobre as {abertas} licitações abertas — o agente consulta a base e responde."; `SearchBox size="hero" name="q" action="/licitacoes" placeholder="Ex.: pregões de material escolar em SP que fecham esta semana"` with two static pills in its left slot: "Agente" (sparkle icon + chevron) and "Abertas" (list icon + chevron) — decorative this cycle (`Button variant="pill" size="sm" type="button"`, no behavior); the form submits the text as a plain `q` search. Below: four example chips as `LinkButton variant="pill"`: "O que fecha esta semana?" → `/licitacoes?status=aberta`, "Meus melhores fits" → `/licitacoes?fit=fit`, "Vão abrir" → `/licitacoes?status=vai_abrir`, "Valor médio por modalidade" → `/painel`. Then a KPI strip of 3 `StatTile`s (abertas / vão abrir / fechadas from `fetchStatusCounts`) and a ghost link "Ver painel completo →" to `/painel`. No charts on `/`.

New `/painel/page.tsx`: exactly the old dashboard content (escopo tabs + 4 charts) moved here, using `Section` and the restyled charts. Keep `?escopo=`.

Charts: replace hardcoded hex (`#234FC8`, `#299965`, `#CB750B`, `#4E6FBC`) with CSS token references (`var(--color-accent)`, `var(--color-ok)`, `var(--color-warn)`, `var(--color-off)` — names per direction doc); `stat-tile` → flat tone-separated tile, no shadow; `bar-list` hairline rows; `daily-line` keep SVG logic, restyle strokes/labels.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s localhost:3100/login | grep -q 'font-display' && pkill -f "next-server"` (home/painel need a session cookie; build success + tsc cover them — state in report if you could verify with a real session via `PLIC_DATABASE_URL`)

## Done when
- `/` shows hero + chips + KPI strip; `/painel` shows the old charts restyled; no hex colors left in `charts/`.

## Not included
- No new queries or filters (no `encerraEm`), no sidebar edits (ticket 31 added `/painel`), no other pages.
