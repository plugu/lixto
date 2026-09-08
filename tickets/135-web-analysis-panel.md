---
id: 135
status: done
model: sonnet
depends_on: [134]
max_attempts: 3
files:
  - web/lib/analysis-queries.ts
  - web/lib/analysis-queries.test.ts
  - web/lib/analysis-labels.ts
  - web/components/analysis-panel.tsx
  - web/components/citation-link.tsx
  - web/components/enrichment-panel.tsx
  - web/app/(app)/procurement/[sourceId]/page.tsx
---
## Goal
The procurement detail page renders the cited dossier from `tender_analyses` + children in place of `EnrichmentPanel`, every fact linking to its PNCP document and page.

## Context
Cycle 25 (PRODUCT.md, "UI = detail page"). Tables and CHECK enums: `migrations/006_tender_analysis.sql` (ticket 131). Ticket 134 added `web/lib/analysis-queries.ts` (summary/job/enqueue) and `AnalyzeButton`; extend that module, don't fork it. `web/components/enrichment-panel.tsx` is **deleted** (its only consumer is this page; `web/lib/enrichment-queries.ts` stays — `lib/recommend.ts` imports it). ME/EPP flags still come from `procurement_enrichments` (`fetchEnrichment`, already on the page) and are shown in the dossier header. UI kit: `Card`/`CollapsibleCard` (`web/components/ui/card.tsx`), `Badge` (tones `neutral|ok|warn|off|accent`), `Table/THead/TBody/TR/TH/TD` (`web/components/ui/table.tsx`), icons `Alert`, `Link`, `Calendar`; `formatCurrencyBRL`/`formatDateBR` in `web/lib/format.ts`. Portuguese copy, server components only (no client JS in the panel).

### `web/lib/analysis-queries.ts` additions
- Types mirroring the tables: `AnalysisFact`, `AnalysisDate`, `AnalysisRequirement`, `AnalysisPenalty`, `AnalysisRisk`, `AnalysisMissing`, `Citation = { sequence: number; page: number }`, and `TenderAnalysis = { procurement_id, version, status, error, model, input_kind, input_truncated, executive_summary, object_text, overall_risk, analyzed_at, facts[], dates[], requirements[], penalties[], risks[], missing[] }`.
- `buildFetchAnalysis(procurementId)` for the head row (never select `data`) and one builder per child table (`ORDER BY sequence` / facts by `id`), plus `fetchAnalysis(procurementId): Promise<TenderAnalysis | null>` (null when no row or `status='error'`; `Promise.all` over the six child queries). `citations` arrive as JSONB → already parsed by pg.

### `web/lib/analysis-labels.ts`
pt-BR labels for every enum: fact keys (the suggested keys of ticket 132 → label fallback = the row's own `label`), `date kind`, `requirement category` (`participation: "Participação"`, `legal: "Habilitação jurídica"`, `fiscal_labor: "Regularidade fiscal e trabalhista"`, `economic_financial: "Qualificação econômico-financeira"`, `technical: "Qualificação técnica"`, `specification: "Especificação técnica"`, `guarantee: "Garantias"`, `other: "Outros"`), `severity`, `risk kind` (`risk: "Risco"`, `red_flag: "Alerta"`, `contradiction: "Contradição"`, `amendment: "Alteração"`), `confidence`, `statement_kind` (`inference: "Inferência"`), `overall_risk` with badge tone (`low: ok`, `medium: warn`, `high: off`, `critical: off`).

### `web/components/citation-link.tsx`
`<CitationLinks citations={...} documents={...} />`: for each citation find the document by `sequence` in the page's `DocumentRow[]` (`fetchDocuments` result — `sequence, title, type_id, type_name, url`); render `<a href={`${url}#page=${page}`} target="_blank" rel="noopener noreferrer">` with text `Doc {sequence} · p. {page}` and `title={document title}`; citation whose document is missing/has no url renders as plain text `Doc {sequence} · p. {page}`. Small, muted, inline after the statement.

### `web/components/analysis-panel.tsx`
`<AnalysisPanel analysis documents enrichment />` (`enrichment: EnrichmentRow | null` for ME/EPP badges only). Layout, top to bottom (each section hidden when empty):
1. **Header** — eyebrow `Análise com IA · v{version}`, `overall_risk` badge, ME/EPP badges, `Analisado em {formatDateBR(analyzed_at, true)}`; when `input_truncated`: warn badge `Documentos parcialmente lidos`.
2. **Resumo** — `executive_summary` (pre-wrap) and `object_text` under a small "Objeto" heading.
3. **Dados principais** — `facts` with `group='basic'` as a 2-column `dl` (label → value + `CitationLinks`; `statement_kind='inference'` gets a neutral `Inferência` badge; `confidence='low'` gets a warn `Verificar` badge).
4. **Prazos** — `dates` table: label, `occurs_at` (`formatDateBR(…, true)`, else `raw_text`), citations. A date with `occurs_at` within the next 3 days (and in the future) gets an `Alert` icon + warn badge `Em {n} dia(s)`; today's date passed in as a prop-free `new Date()` is fine (server render).
5. **Participação e habilitação** — `requirements` grouped by `category` in the order of the labels map; each row: title (bold), description, `mandatory ? "Obrigatório" : "Opcional"` badge, severity badge (`high|critical` → off tone), inference/low-confidence badges, citations.
6. **Condições comerciais** — `facts` with `group='commercial'`, same `dl` as section 3.
7. **Penalidades** — list: description, `basis` in muted text, citations.
8. **Riscos e alertas** — `risks` with `kind in (risk, red_flag)` sorted by severity desc: kind badge, severity badge, title, description, `recommendation` prefixed "Recomendação:", citations.
9. **Contradições e alterações** — `risks` with `kind in (contradiction, amendment)`, same row format.
10. **Informações não encontradas** — `missing` as a bullet list (`field` — `note`).
Wrap in an accented `CollapsibleCard` like today's panel (`border-t-2 border-t-accent`); sections 5–10 as nested `CollapsibleCard`s (`defaultOpen` for 5 and 8 only).

### Page wiring
Replace the `EnrichmentPanel` import/usage: fetch `fetchAnalysis(detail.id)` in the `Promise.all`; when non-null render `<AnalysisPanel>` in the **main** column (full width, above "Itens"), not the 22rem sidebar — the dossier is the page's content. Keep the sidebar grid only when there is no analysis but there is an enrichment: in that case show a one-line `Card` "Análise resumida disponível — clique em Analisar com IA para o dossiê completo" instead of the old panel. Keep `AnalyzeButton` where ticket 134 put it.

Tests (`analysis-queries.test.ts`): builder SQL/params for the head + six child queries; `fetchAnalysis` returns null on `status='error'` (mocked pool). No component tests (server components; the build is the check).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx next typegen && npx tsc --noEmit`
3. `cd web && npm test`
4. `cd web && npm run build`
5. `! test -f web/components/enrichment-panel.tsx && ! grep -rn "enrichment-panel\|EnrichmentPanel" web/app web/components web/lib --include="*.ts*"`

## Done when
- On the dev stack, a procurement with a `tender_analyses` row renders the dossier sections above; clicking a citation opens the PNCP PDF at that page in a new tab; a procurement without a dossier shows the button (134) and no panel.
- `npm run build` passes with `enrichment-panel.tsx` gone and `lib/recommend.ts` untouched.

## Not included
- In-app PDF viewer; company match / compliance matrix / bid score (V2).
- Editing or re-ordering the "Itens" and "Documentos" cards.
- Any Python change or docs (ticket 136).
