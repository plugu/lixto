---
id: 66
status: todo
model: opus
depends_on: [63, 65]
max_attempts: 3
files:
  - web/lib/match-engine.ts
  - web/lib/match-engine.test.ts
  - web/lib/match-queries.ts
  - web/lib/match-queries.test.ts
---
## Goal
Given an empresa and optional filters, return candidate licitações each with a deterministic 0–100 score and machine-readable reasons, computed on demand from global enrichment × the empresa profile.

## Context

Read `PRODUCT.md`, then the schemas in `migrations/010_enriquecimento.sql` (ticket 63) and `migrations/011_perfil_match.sql` (ticket 65). This is the heart of the cycle; the scoring rule is decided **here, exactly as written** — do not invent weights or add an LLM. On-demand (no `match` table) so a just-edited profile is reflected instantly; batch/proactive is a later cycle.

Conventions: `pool` from `web/lib/db.ts` (relative import in lib files), every outside value bound as `$n`, exported row types, one exported async function per query — see `web/lib/preco-queries.ts` for the template. Tests: vitest, mocked pool, no live DB. `f_unaccent`, GIN FTS on `objeto_compra`/`item.descricao` (migration 005) and `licitacao_cnae` (008) already exist. `PORTAIS_ATIVOS` from `web/lib/portais.ts` is always applied. Prod Postgres is stock `postgres:18` — **no pgvector**.

### `web/lib/match-engine.ts` — pure, no I/O

```ts
export type MotivoCodigo =
  | "cnae_principal" | "cnae_secundario" | "termo_enriquecimento" | "termo_texto"
  | "uf_ok" | "uf_fora" | "valor_ok" | "valor_fora" | "valor_desconhecido"
  | "me_epp_exclusivo" | "exige_certificacao" | "exige_atestado" | "exclusao" | "sem_perfil";
export type Motivo = { codigo: MotivoCodigo; peso: number; detalhe: string };
export type CandidatoFatos = {
  numero_controle_pncp: string; uf: string | null; valor_total_estimado: string | null;
  cnae_hits_principal: string[]; cnae_hits_secundario: string[];
  termo_hits: string[];      // perfil.termos ∩ (enriquecimento.palavras_chave ∪ conceitos)
  texto_hit: boolean;        // FTS hit of perfil terms on objeto/itens
  exclusao_hit: boolean;     // FTS hit of perfil exclusões on objeto/itens
  me_epp_exclusivo: boolean | null; exige_certificacao: boolean | null; exige_atestado_tecnico: boolean | null;
};
export type PerfilResumo = { termos: string[]; ufs: string[]; valor_min: string | null; valor_max: string | null; porte: string | null };
export function scoreCandidate(f: CandidatoFatos, p: PerfilResumo): { score: number; motivos: Motivo[] };
```

Rule (sum, then clamp 0..100; every applied line becomes a `Motivo` with its `peso`):
- CNAE: principal hit +35 (`detalhe` = the code) — else secundário hit +25 — else 0, no motivo.
- Terms: `termo_hits.length >= 2` → +35 (`detalhe` = hits joined by ", "), `== 1` → +25, else `texto_hit` → +15 (`termo_texto`), else 0.
- UF: `p.ufs` empty or contains `f.uf` → +10 `uf_ok`; else −20 `uf_fora`.
- Valor: `f.valor_total_estimado` null → +5 `valor_desconhecido`; inside `[valor_min, valor_max]` (null bound = open) → +10 `valor_ok`; outside → −15 `valor_fora`.
- `me_epp_exclusivo === true` and `p.porte` not in `MEI|ME|EPP` → −40.
- `exige_certificacao === true` → −5 (informational motivo); `exige_atestado_tecnico === true` → −5.
- `exclusao_hit` → −50.
- `p.termos` empty and no CNAE hits → single motivo `sem_perfil` peso 0, score 0.
Numeric strings (`"184000.00"`) compared with `Number()`.

### `web/lib/match-queries.ts`

```ts
export type MatchFilters = { q?: string; ufs?: string[]; statuses?: ("aberta"|"vai_abrir"|"fechada")[]; modalidadeIds?: number[]; valorMin?: number; valorMax?: number; numeros?: string[] };
export type MatchRow = {  // LicitacaoRow fields (web/lib/queries.ts) + enrichment + score
  numero_controle_pncp: string; objeto_compra: string | null; orgao_razao_social: string | null; municipio_nome: string | null; uf: string | null;
  modalidade_nome: string | null; valor_total_estimado: string | null; data_abertura_proposta: Date | null; data_encerramento_proposta: Date | null;
  resumo: string | null; riscos: string[] | null; complexidade: string | null; enriquecido: boolean;
  score: number; motivos: Motivo[];
};
export function buildCandidateQuery(empresaId: number, filters: MatchFilters, perfil: PerfilResumo & { exclusoes_termos: string[] }, candidateLimit: number): SqlQuery; // empresaId is always $1
export async function fetchMatches(empresaId: number, filters: MatchFilters, limit = 20): Promise<MatchRow[]>;
```

`buildCandidateQuery` — one statement, CTEs:
- `perfil AS (SELECT termos, exclusoes_termos, ufs, valor_min, valor_max FROM empresa_perfil WHERE empresa_id = $1)`, `porte AS (SELECT porte FROM empresa WHERE id = $1)`, `cnaes AS (SELECT codigo, principal FROM empresa_cnae WHERE empresa_id = $1)`.
- Term tsquery: `fetchMatches` first loads the perfil (`getPerfil` from `web/lib/perfil-queries.ts`) and the empresa `porte`, then builds in TS `termosQuery = terms.map(t => "(" + t.split(" ").join(" & ") + ")").join(" | ")` and binds it as a parameter fed to `to_tsquery('portuguese', f_unaccent($n))`; same for `exclusoes_termos`. Sanitize each term to `[a-z0-9 ]` before building; an empty term list binds `null` and the corresponding predicate is `false`. `termos` itself is also bound as `text[]` for the array intersection below. `buildCandidateQuery` therefore takes `perfil: PerfilResumo` as a third argument (pure, testable).
- Candidate predicate (all bound): `usuario_nome = ANY($portais)`, status predicates copied from `STATUS_PREDICATES` in `web/lib/queries.ts` (default `aberta OR vai_abrir` when `filters.statuses` absent), optional `uf = ANY`, `modalidade_id = ANY`, `valor_total_estimado >=/<=`, `numero_controle_pncp = ANY($numeros)`, optional free-text `q` via `websearch_to_tsquery` on objeto/itens exactly as in `queries.ts`. Plus **at least one signal** unless `numeros` is given: `cnae_hit OR termo_hit OR texto_hit`.
- Facts per row: `cnae_hits_principal = ARRAY(SELECT lc.codigo FROM licitacao_cnae lc JOIN cnaes c ON c.codigo = lc.codigo AND c.principal WHERE lc.numero_controle_pncp = l.numero_controle_pncp)`, same for secundário (`NOT c.principal`); `termo_hits = ARRAY(SELECT unnest(e.palavras_chave || e.conceitos) INTERSECT SELECT unnest($termos::text[]))`; `texto_hit = (to_tsvector('portuguese', f_unaccent(coalesce(l.objeto_compra,''))) @@ to_tsquery('portuguese', f_unaccent($tq)) OR EXISTS (item FTS with the same tsquery))`; `exclusao_hit` likewise with the exclusões tsquery (false when none); `e.me_epp_exclusivo, e.exige_certificacao, e.exige_atestado_tecnico, e.resumo, e.riscos, e.complexidade, (e.numero_controle_pncp IS NOT NULL) AS enriquecido` via `LEFT JOIN enriquecimento e ON e.numero_controle_pncp = l.numero_controle_pncp AND e.status = 'done'`.
- `ORDER BY data_encerramento_proposta ASC NULLS LAST LIMIT $candidateLimit` (use 200). Scoring/sorting happens in TS: `fetchMatches` maps rows through `scoreCandidate`, sorts by `score DESC, data_encerramento_proposta ASC`, returns the first `limit`.

No `empresa_perfil` row → treat as empty terms/ufs/null bounds (CNAE-only matching still works).

### Tests

- `match-engine.test.ts`: every rule line above with a minimal `CandidatoFatos`; clamp at 0 and 100; `sem_perfil`; numeric-string bounds.
- `match-queries.test.ts`: `buildCandidateQuery` binds `empresaId` as `$1`, contains `usuario_nome = ANY`, includes `numero_controle_pncp = ANY` only when `numeros` given, builds the tsquery string `(lapis) | (lapis & preto)` from `["lapis", "lapis preto"]`, binds `null` for empty terms; `fetchMatches` with mocked pool sorts by score and truncates to `limit`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`

## Done when
- `fetchMatches(empresaId, { q: "lapis", ufs: ["RJ"] })` returns scored rows with motivos, highest score first, without any string interpolation of outside values.
- A licitação flagged `me_epp_exclusivo` scores 40 lower for a `GRANDE` empresa than for an `ME` one, with the motivo present.

## Not included
- UI, API routes, or LLM calls (tickets 67–69).
- A persisted `match` table, notifications, or batch scoring in Python.
- pgvector / embeddings; changing `web/lib/queries.ts`.
