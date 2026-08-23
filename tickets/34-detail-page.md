---
id: 34
status: doing
model: sonnet
depends_on: [31]
max_attempts: 3
files:
  - web/app/licitacao/[numeroControle]/page.tsx
  - web/components/analise-panel.tsx
  - web/components/itens-table.tsx
  - web/components/documentos-list.tsx
---
## Goal
`/licitacao/[numeroControle]` in the new system: header block (objeto, órgão, status dot, fit badge, key facts), two-column body — itens + documentos at left, análise panel at right — all tone-separated, no cards with borders/shadows.

## Context
Read `docs/design/cycle8-direction.md` and `web/components/ui/*.tsx` first. Ticket 33 restyles `fit-badge.tsx`/`status-badge.tsx` in parallel — **import and use them as-is** (their props don't change: `FitBadge{verdict,score}`, `StatusBadge{status}`); do not edit those files.

Today: `page.tsx` (200 lines) calls `detail-queries` (`fetchLicitacaoDetail` + itens/documentos), `analise-queries.fetchAnalise`, `format`, `status.computeStatus`; renders `AnalisePanel{analise}` (`section.rounded-lg…shadow-card`, verdict + reasoning + requirements/prazos/risks), `ItensTable{itens}`, `DocumentosList{documentos}` (Edital vs Anexos by `tipo_documento_id === 2`, external links).

New layout:
- Back link "← Licitações" (ghost `LinkButton`, preserves nothing — plain `/licitacoes`).
- Header: objeto as `font-display text-2xl`; line 2: órgão · município/UF · modalidade; line 3: `StatusBadge` + `FitBadge` + `Badge` for portal; facts grid (4 cols: Valor estimado, Abertura, Encerramento, Nº controle) with mono/tabular numbers, labels 12px muted.
- Body `grid lg:grid-cols-[1fr_22rem] gap-10`: left `Section title="Itens"` → `ItensTable` on kit `Table density="compact"`; `Section title="Documentos"` → `DocumentosList` as a list of rows (icon FileText, nome, tipo badge, Download icon link at right). Right: `AnalisePanel` as a sticky (`lg:sticky lg:top-8`) `Section eyebrow="Análise"` with verdict row, reasoning paragraph, then requirements table (kit compact), prazos list, risks list with Alert icon; `deep_status` skipped/error → small muted note.
- Page uses `page-wide`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s localhost:3100/login | grep -q 'font-display' && pkill -f "next-server"`

## Done when
- Detail renders in the new system for licitações with and without `analise`, with zero and many itens/documentos.

## Not included
- No query changes, no badge component edits, no list page.
