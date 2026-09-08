---
id: 129
status: done
model: sonnet
depends_on: [128]
max_attempts: 3
files:
  - web/lib/radar-analysis.ts
  - web/lib/radar-analysis.test.ts
  - web/lib/radar-analysis-queries.ts
  - web/lib/radar-analysis-queries.test.ts
  - web/app/(app)/radar/[id]/analyze-action.ts
  - web/components/radar-analysis.tsx
  - web/app/(app)/radar/[id]/page.tsx
---
## Goal
"Analisar com IA" on `/radar/[id]` produces a cached, evidence-grounded analysis (why it may happen / company fit / how to prepare) once per opportunity×company.

## Context
Cycle 24 Radar (PRODUCT.md): LLM is called **only** on demand, result cached in `future_opportunity_analyses (company_id, future_opportunity_id, model, content JSONB, UNIQUE pair)` created in ticket 124. Zero LLM spend for unopened items.

**`web/lib/radar-analysis.ts`** — pattern: `web/lib/recommend.ts` (pure prompt builder + parser, injectable client). Export:
- `RADAR_ANALYSIS_MODEL = process.env.LIXTO_RADAR_ANALYSIS_MODEL ?? process.env.LIXTO_RECOMMEND_MODEL ?? "gpt-5.1"`; `RADAR_ANALYSIS_DAILY_CAP` from env `LIXTO_RADAR_ANALYSIS_DAILY_CAP` (default 20, per company per day, 0 = unlimited).
- `buildRadarAnalysisPrompt(input: { opportunity: RadarDetail; signals; reasons; profile: CompanyProfile | null }): { system, user }` — system prompt (pt-BR) forbids inventing facts, requires hedged language ("provável", "estimado", "sinal detectado"), and demands JSON `{ "why_it_may_happen": string, "company_fit": string, "preparation": string[] }`; the user message serialises only the facts the page already shows (title, agency, unit, state, value, quantity, expected date, PCA year/dates, signal and reason lines, profile products/keywords/states/value band). No history/competition sections — V1 has no such data; say so in the system prompt so the model does not fabricate them.
- `parseRadarAnalysis(text): RadarAnalysis | null` (strip ``` fences, validate shape, cap each string at 800 chars, `preparation` ≤ 6 items).
- `analyzeOpportunity(companyId, id, deps: { client?: OpenAI } = {}): Promise<{ analysis, cached: boolean } | { error: string }>` — returns cached row if present; else enforces the daily cap (`countAnalysesToday(companyId)`), loads detail (`fetchRadarDetail` from `./radar-detail-queries`) + profile (`getProfile`), calls `getChatClient()` (`./agent/llm`) with `response_format: { type: "json_object" }`, parses, `insertAnalysis`. Errors in pt-BR: "limite diário de análises atingido", "sem chave de API configurada" (use `hasApiKey`-style check as `recommend.ts:333`), "não foi possível gerar a análise".

**`web/lib/radar-analysis-queries.ts`**: `getAnalysis(companyId, id)`, `insertAnalysis(companyId, id, model, content)` (`ON CONFLICT DO NOTHING` then re-read), `countAnalysesToday(companyId)` (`created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')` — bind nothing but `$1`).

**Action** `web/app/(app)/radar/[id]/analyze-action.ts` (`"use server"`): `analyzeRadarAction(id)` → `requireSession()` → `analyzeOpportunity(companyId, id)` → `revalidatePath(`/radar/${id}`)`; returns `{ ok: true, analysis } | { error }`.

**UI** `web/components/radar-analysis.tsx` (client, `useTransition`): props `{ id, initial: RadarAnalysis | null, model?: string }`. Empty → button "Analisar com IA" + caption "Gera uma análise a partir dos sinais mostrados acima; nenhuma previsão é uma confirmação." Filled → three blocks "Por que pode acontecer", "Compatibilidade com a empresa", "Como se preparar" (ordered list) + footer "Gerado por {model} em {formatDateBR(created_at)}". Replace the "Disponível em breve" placeholder card in `web/app/(app)/radar/[id]/page.tsx` with `<RadarAnalysis>` fed by `getAnalysis(companyId, id)`.

Tests: prompt builder (all facts present, no history section), parser (fences, truncation, bad JSON → null), `analyzeOpportunity` with mocked `./db`, `./agent/llm`, and `./radar-detail-queries` (cached path makes no LLM call; cap path returns error; success inserts).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/radar-analysis.test.ts lib/radar-analysis-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`

## Done when
- On a matched opportunity, clicking "Analisar com IA" (with `LIXTO_LLM_API_KEY` set in `web/.env.local`) renders the three sections within one request; reloading shows the same text without a new LLM call (`future_opportunity_analyses` has exactly one row for the pair); the 21st analysis of the day for the company returns the cap error.

## Not included
- Batch/pre-generated analyses; digest inclusion.
- Competition / agency-history sections (V2/V3 data).
- Regenerate button (delete the row manually if needed).
