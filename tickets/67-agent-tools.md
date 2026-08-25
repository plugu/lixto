---
id: 67
status: doing
model: opus
depends_on: [66]
max_attempts: 3
files:
  - web/lib/agent/types.ts
  - web/lib/agent/tools.ts
  - web/lib/agent/tools.test.ts
  - web/lib/enriquecimento-queries.ts
---
## Goal
A safe, validated tool layer the LLM can call — every tool maps a structured intent to existing query builders, scoped to the session's empresa; the model never sees SQL.

## Context

Read `PRODUCT.md` (section on intents: the backend, not the LLM, turns intents into DB operations) and `docs/TENANT.md`. Reuse, never re-implement: `web/lib/queries.ts` (`fetchLicitacoes`, `LicitacaoFilters`), `web/lib/detail-queries.ts` (`fetchLicitacaoDetail`, `fetchItens`, `fetchDocumentos`), `web/lib/analise-queries.ts` (`fetchAnalise`), `web/lib/match-queries.ts` (`fetchMatches`, ticket 66), `web/lib/perfil-queries.ts` (`getPerfil`, ticket 65). No new npm deps — validate arguments by hand like `parseFilters` in `queries.ts` (unknown/invalid values dropped, never thrown to the model as a stack trace).

### `web/lib/enriquecimento-queries.ts`

`export type EnriquecimentoRow = { numero_controle_pncp; status; fonte; resumo; categorias: string[]; conceitos: string[]; palavras_chave: string[]; requisitos: {tipo: string; descricao: string}[]; exige_certificacao; exige_atestado_tecnico; me_epp_exclusivo; me_epp_preferencia; entrega: {local: string|null; prazo_dias: number|null} | null; riscos: string[]; complexidade; confianca: number|null; modelo; enriquecido_em: Date }` and `export async function fetchEnriquecimento(numero: string): Promise<EnriquecimentoRow | null>` (only `status = 'done'`).

### `web/lib/agent/types.ts`

```ts
export type ToolContext = { empresaId: number; porte: string | null; empresaNome: string };
export type LicitacaoRef = { numero_controle_pncp: string; objeto: string | null; orgao: string | null; uf: string | null; municipio: string | null;
  modalidade: string | null; valor_estimado: string | null; encerramento: string | null; status: "aberta"|"vai_abrir"|"fechada"; score?: number; motivos?: Motivo[] };
export type ToolResult = { ok: true; data: unknown; refs: LicitacaoRef[] } | { ok: false; erro: string };
export type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown> /* JSON Schema */ };
```
`LicitacaoRef` is what the UI renders as a card (ticket 69) and what the model cites; `data` is the compact JSON the model reads (keep it small: no `raw`, itens ≤ 20, descriptions ≤ 160 chars).

### `web/lib/agent/tools.ts`

`export const TOOL_DEFINITIONS: ToolDefinition[]` (OpenAI function-calling `parameters` schemas, descriptions in PT-BR so the model maps user phrasing) and `export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult>`. Unknown tool → `{ ok: false, erro: "ferramenta desconhecida" }`.

Tools:
1. `search_procurements` — args `{ q?: string; ufs?: string[]; statuses?: string[]; modalidadeIds?: number[]; valorMin?: number; valorMax?: number; limit?: number }`. Default `statuses = ["aberta"]`, `limit` clamped 1..20. Calls `fetchLicitacoes(filters, limit, 0)` and returns `{ total, itens: LicitacaoRef[] }` plus the same as `refs`. `status` computed with `computeStatus` from `web/lib/status.ts`.
2. `search_my_matches` — same args minus `statuses` default `["aberta","vai_abrir"]`; calls `fetchMatches(ctx.empresaId, filters, limit)`; refs carry `score` + `motivos`. If the empresa has no `empresa_perfil` **and** no CNAEs, return `{ ok: true, data: { aviso: "perfil de match não configurado", url: "/empresa/perfil" }, refs: [] }`.
3. `get_procurement` — `{ numero: string }` → detail (`fetchLicitacaoDetail`), itens (≤ 20), documentos (title + url), enriquecimento summary (`resumo`, `categorias`, `requisitos`, `riscos`, `entrega`, `me_epp_exclusivo`), and `analise` verdict if present. One ref.
4. `calculate_match` — `{ numeros: string[] }` (1..10) → `fetchMatches(ctx.empresaId, { numeros, statuses: ["aberta","vai_abrir","fechada"] }, numeros.length)`; data = per numero `{ score, motivos }`; refs with scores.
5. `analyze_procurement` — `{ numero: string }` → everything from `get_procurement` **plus** the match for this empresa (`calculate_match` for one) **plus** the empresa's perfil summary (termos, ufs, faixa de valor, porte) so the model can reason about fit, requisitos it likely meets/misses and riscos. No new LLM call inside the tool — reasoning happens in the chat model (ticket 68) from this data.

Argument validation helpers (`asStringArray`, `asIntArray`, `asNumber`, `asUf` using `UF_LIST` from `web/lib/tenant-types.ts`) exported for tests. `numero` must match `/^\d{14}-\d-\d{6}\/\d{4}$/`; otherwise `{ ok: false, erro: "número de controle inválido" }`. Every query error is caught and returned as `{ ok: false, erro: "falha ao consultar" }` (log the real error with `console.error`).

### Tests (`tools.test.ts`)

Mock the lib modules with `vi.mock` (`../queries`, `../detail-queries`, `../analise-queries`, `../match-queries`, `../perfil-queries`, `../enriquecimento-queries`). Assert: defaults and clamps for `search_procurements`; `ctx.empresaId` (never args) reaches `fetchMatches`; invalid numero → error result; `search_my_matches` aviso path; `analyze_procurement` composes all sources and returns one ref with score; unknown tool.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`

## Done when
- `executeTool("search_procurements", { q: "lápis", ufs: ["rj"] }, ctx)` returns refs with status and normalized filters (`ufs: ["RJ"]`).
- No tool accepts or forwards an `empresaId`; every DB call is via an existing query module with bound parameters.

## Not included
- The model loop, prompts, streaming, persistence (ticket 68) or React (69).
- `list_missing_documents`, `prepare_participation`, `compare_procurements` — next cycles.
- Modifying `web/lib/queries.ts`, `detail-queries.ts`, `match-queries.ts`.
