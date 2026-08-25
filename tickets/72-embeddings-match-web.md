---
id: 72
status: done
model: opus
depends_on: []
max_attempts: 3
files:
  - web/lib/agent/embed.ts
  - web/lib/agent/embed.test.ts
  - web/lib/perfil-queries.ts
  - web/lib/perfil-queries.test.ts
  - web/app/(app)/empresa/perfil/actions.ts
  - web/lib/match-engine.ts
  - web/lib/match-engine.test.ts
  - web/lib/match-queries.ts
  - web/lib/match-queries.test.ts
  - web/components/chat/licitacao-ref-card.tsx
---
## Goal
The empresa profile gets an embedding on save, and the match engine gains a fixed-weight semantic signal (cosine similarity via pgvector) with its own motivo.

## Context

Read `PRODUCT.md`. Schema (DDL owned by ticket 71, running in parallel — code against these names): `enriquecimento.embedding vector(1536)`, `enriquecimento.embedding_modelo`, `empresa_perfil.embedding vector(1536)`, `empresa_perfil.embedding_texto TEXT`, `empresa_perfil.embedding_modelo TEXT`. Embedding model env `PLIC_LLM_MODEL_EMBED` (default `text-embedding-3-small`, 1536 dims), same client env as `web/lib/agent/llm.ts` (`PLIC_LLM_API_KEY`/`OPENAI_API_KEY`, `PLIC_LLM_BASE_URL`). Extend existing modules; keep every exported signature from cycle 16 working (ticket 67's tools call `fetchMatches(empresaId, filters, limit)` unchanged). node-pg has no vector type: bind the vector as the text `"[0.1,0.2,...]"` and cast in SQL with `$n::vector`. Tests: vitest with mocked pool / mocked OpenAI, as in `web/lib/match-queries.test.ts` and `web/lib/agent/run.test.ts`.

### `web/lib/agent/embed.ts`

```ts
export const EMBED_MODEL = process.env.PLIC_LLM_MODEL_EMBED ?? "text-embedding-3-small";
export const EMBED_DIMS = 1536;
export function toPgVector(vec: number[]): string;               // "[0.1,0.2,...]"
export function buildPerfilEmbeddingText(input: { produtos: string[]; palavrasChave: string[]; observacoes: string }): string; // "produtos: …\npalavras-chave: …\nobservações: …" skipping empty parts
export async function embedText(text: string, deps?: { client?: OpenAI; model?: string }): Promise<{ vector: number[]; model: string } | null>;
```
`embedText` returns `null` (and `console.warn`s) when no API key is configured or the SDK throws — embeddings are best-effort on the web side; the profile must still save.

### `web/lib/perfil-queries.ts` + `actions.ts`

- `PerfilMatch` gains `embedding_texto: string | null` (do not select the vector column itself — it's large and unused in TS).
- `buildUpsertPerfil(empresaId, input, embedding?: { vector: number[]; model: string; texto: string } | null)` — when given, also sets `embedding = $n::vector, embedding_texto = $n, embedding_modelo = $n`; when `null`/absent, leaves those columns untouched on update (and NULL on insert). `upsertPerfil` gets the same optional third argument.
- `updatePerfilAction`: after validation, `const texto = buildPerfilEmbeddingText(...)`; call `embedText(texto)`; pass the result to `upsertPerfil`. Failure → still saves, returns `{ ok: true, aviso: "Perfil salvo; similaridade semântica indisponível no momento." }` (add `aviso?: string` to the action state and render it in the form only if trivial — otherwise leave the form untouched and just keep the field on the state).
- Tests: `buildUpsertPerfil` with and without embedding (binds `::vector` param only when given; `$1` stays `empresaId`).

### `web/lib/match-engine.ts`

- `MotivoCodigo` gains `"semantico_alto" | "semantico"`.
- `CandidatoFatos` gains `similaridade: number | null` (cosine similarity 0..1, null when either side lacks a vector).
- Rule (append to the existing sum; weights fixed): `similaridade >= 0.55` → +20 `semantico_alto` (`detalhe` = `sim=0.61`), `>= 0.40` → +10 `semantico`, else nothing. `sem_perfil` now applies only when `termos` empty **and** no CNAE hits **and** `similaridade` is null. Clamp stays 0..100 (max raw is now 110).
- Tests for the three bands, the `sem_perfil` change, and that the rest is unchanged.

### `web/lib/match-queries.ts`

- `fetchMatches` loads the perfil embedding via a small new query `SELECT embedding::text AS embedding FROM empresa_perfil WHERE empresa_id = $1` (export `getPerfilEmbeddingText(empresaId): Promise<string | null>` from `perfil-queries.ts` and use it) — keep it separate from `getPerfil` so existing mocks in `tools.test.ts`/`run.test.ts` keep passing; add it as the 4th query in the sequence documented in the test file.
- `buildCandidateQuery(empresaId, filters, perfil, candidateLimit, perfilEmbedding?: string | null)`:
  - when `perfilEmbedding` is provided: add CTE `semantico AS (SELECT numero_controle_pncp, 1 - (embedding <=> $k::vector) AS similaridade FROM enriquecimento WHERE embedding IS NOT NULL ORDER BY embedding <=> $k::vector LIMIT 200)` and `LEFT JOIN semantico s USING (numero_controle_pncp)`; select `s.similaridade`; the "at least one signal" predicate becomes `cnae_hit OR termo_hit OR texto_hit OR s.similaridade >= 0.40`.
  - when absent: select `NULL::real AS similaridade`, predicate unchanged. The parameter index `$k` must be bound (never interpolated).
- Map `similaridade` (string/number from pg → `Number` or null) into `CandidatoFatos`.
- Tests: SQL contains `<=>` and binds the vector text only when provided; rows with `similaridade: "0.62"` score `semantico_alto`.

### `web/components/chat/licitacao-ref-card.tsx`

Add labels `semantico_alto` → "similar ao perfil", `semantico` → "afinidade semântica" to the motivo-chip label map (neutral/ok tone). Nothing else.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`

## Done when
- Saving `/empresa/perfil` with an API key configured writes `empresa_perfil.embedding`; without a key it still saves.
- `fetchMatches` returns a `semantico`/`semantico_alto` motivo for rows whose cosine similarity clears the band, and all cycle-16 tests still pass unchanged.

## Not included
- Python side (ticket 71), migrations, docker-compose.
- Query embedding for `search_procurements`; UI beyond the chip labels; reranking.
