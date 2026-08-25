// Candidate retrieval for the match engine (ticket 66). One statement gathers
// the facts (CNAE overlap, enrichment-keyword intersection, FTS hits, the
// enrichment flags); scoring and ordering happen in TS via
// `scoreCandidate` — see match-engine.ts.
//
// On demand, no `match` table: a profile edited a second ago is already
// reflected. Every value from the outside world (empresaId, filters, the
// tsquery strings) is bound as $n — never string-interpolated into SQL text.

import { pool } from "./db";
import { scoreCandidate, type Motivo, type PerfilResumo } from "./match-engine";
import {
  getPerfil,
  getPerfilEmbeddingText,
  type SqlQuery,
} from "./perfil-queries";
import { PORTAIS_ATIVOS } from "./portais";

export type MatchFilters = {
  q?: string;
  ufs?: string[];
  statuses?: ("aberta" | "vai_abrir" | "fechada")[];
  modalidadeIds?: number[];
  valorMin?: number;
  valorMax?: number;
  numeros?: string[];
};

export type MatchRow = {
  numero_controle_pncp: string;
  objeto_compra: string | null;
  orgao_razao_social: string | null;
  municipio_nome: string | null;
  uf: string | null;
  modalidade_nome: string | null;
  valor_total_estimado: string | null;
  data_abertura_proposta: Date | null;
  data_encerramento_proposta: Date | null;
  resumo: string | null;
  riscos: string[] | null;
  complexidade: string | null;
  enriquecido: boolean;
  score: number;
  motivos: Motivo[];
};

/** Row shape returned by `buildCandidateQuery`, before scoring. */
export type CandidatoRow = Omit<MatchRow, "score" | "motivos"> & {
  cnae_hits_principal: string[] | null;
  cnae_hits_secundario: string[] | null;
  termo_hits: string[] | null;
  texto_hit: boolean | null;
  exclusao_hit: boolean | null;
  me_epp_exclusivo: boolean | null;
  exige_certificacao: boolean | null;
  exige_atestado_tecnico: boolean | null;
  /** pg returns numeric expressions as strings unless a type parser says
   * otherwise; normalized with Number() before scoring. */
  similaridade: string | number | null;
};

/** How many rows the SQL side hands to the scorer. Scoring is cheap; the DB
 * scan is not, so this is the real cost knob. */
const CANDIDATE_LIMIT = 200;

/** Rows the pgvector nearest-neighbour scan contributes as candidates. */
const SEMANTIC_TOP_K = 200;

/** Minimum cosine similarity that counts as a signal on its own — same floor
 * as the weakest band in match-engine.ts. */
const SEMANTIC_MIN = 0.4;

// Copied from STATUS_PREDICATES in queries.ts (which this ticket must not
// touch), aliased to `l` — same semantics as the v_abertas/v_futuras/
// v_encerradas views in migrations/001_schema.sql.
const STATUS_PREDICATES: Record<"aberta" | "vai_abrir" | "fechada", string> = {
  aberta:
    "l.data_abertura_proposta <= now() AND now() < l.data_encerramento_proposta",
  vai_abrir: "l.data_abertura_proposta > now()",
  fechada:
    "(l.data_encerramento_proposta < now() OR l.data_encerramento_proposta IS NULL)",
};

/**
 * Turns normalized profile terms into one `to_tsquery` input:
 * `["lapis", "lapis preto"]` → `"(lapis) | (lapis & preto)"`.
 * Each term is sanitized to `[a-z0-9 ]` first, so nothing a user typed can
 * reach the tsquery parser as an operator. Empty list → null (the caller
 * binds it and the predicate collapses to false).
 */
export function buildTermosTsQuery(termos: string[]): string | null {
  const partes = termos
    .map((t) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    )
    .filter((tokens) => tokens.length > 0)
    .map((tokens) => `(${tokens.join(" & ")})`);
  return partes.length === 0 ? null : partes.join(" | ");
}

/**
 * The single candidate statement. `empresaId` is always $1. `perfil` comes in
 * as an argument (already loaded by `fetchMatches`) rather than being read via
 * a CTE, so this stays pure and testable — the profile values it needs are all
 * bound as parameters.
 */
export function buildCandidateQuery(
  empresaId: number,
  filters: MatchFilters,
  perfil: PerfilResumo & { exclusoes_termos: string[] },
  candidateLimit: number,
  perfilEmbedding?: string | null,
): SqlQuery {
  const values: unknown[] = [empresaId];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  const termosParam = bind(perfil.termos);
  const tqParam = bind(buildTermosTsQuery(perfil.termos));
  const exclusaoTqParam = bind(buildTermosTsQuery(perfil.exclusoes_termos));

  // A NULL tsquery would make the whole comparison NULL; the CASE keeps it a
  // plain false so the "at least one signal" predicate stays sargable.
  const ftsHit = (param: string) => `(CASE WHEN ${param}::text IS NULL THEN false ELSE (
        to_tsvector('portuguese', f_unaccent(coalesce(l.objeto_compra, '')))
          @@ to_tsquery('portuguese', f_unaccent(${param}::text))
        OR EXISTS (
          SELECT 1 FROM item i
           WHERE i.numero_controle_pncp = l.numero_controle_pncp
             AND to_tsvector('portuguese', f_unaccent(coalesce(i.descricao, '')))
                 @@ to_tsquery('portuguese', f_unaccent(${param}::text))
        )
      ) END)`;

  const textoHit = ftsHit(tqParam);
  const exclusaoHit = ftsHit(exclusaoTqParam);

  const cnaeHitsPrincipal = `ARRAY(
        SELECT lc.codigo FROM licitacao_cnae lc
          JOIN cnaes c ON c.codigo = lc.codigo AND c.principal
         WHERE lc.numero_controle_pncp = l.numero_controle_pncp
      )`;
  const cnaeHitsSecundario = `ARRAY(
        SELECT lc.codigo FROM licitacao_cnae lc
          JOIN cnaes c ON c.codigo = lc.codigo AND NOT c.principal
         WHERE lc.numero_controle_pncp = l.numero_controle_pncp
      )`;
  const enriquecimentoTermos = `(coalesce(e.palavras_chave, '{}'::text[]) || coalesce(e.conceitos, '{}'::text[]))`;
  const termoHits = `ARRAY(
        SELECT unnest(${enriquecimentoTermos})
        INTERSECT
        SELECT unnest(${termosParam}::text[])
      )`;

  // Semantic top-K: an extra candidate source, so a licitação for "cadernos e
  // apontadores" reaches an empresa selling "material escolar" with zero
  // keyword overlap. The vector is bound as text and cast — node-pg has no
  // vector type — and the CTE is skipped entirely when the perfil has no
  // embedding yet.
  const semanticoCte = perfilEmbedding
    ? (() => {
        const p = bind(perfilEmbedding);
        return `,
    semantico AS (
      SELECT numero_controle_pncp,
             1 - (embedding <=> ${p}::vector) AS similaridade
        FROM enriquecimento
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> ${p}::vector
       LIMIT ${SEMANTIC_TOP_K}
    )`;
      })()
    : "";
  // `ON` rather than `USING`: `l` and `e` both expose numero_controle_pncp,
  // and a USING clause on top of that is ambiguous for Postgres.
  const semanticoJoin = perfilEmbedding
    ? `\n    LEFT JOIN semantico s ON s.numero_controle_pncp = l.numero_controle_pncp`
    : "";
  const similaridadeSelect = perfilEmbedding
    ? "s.similaridade"
    : "NULL::real AS similaridade";

  const conditions: string[] = [];

  // Platform-wide top-7 portal allowlist (ticket 10): always applied.
  conditions.push(`l.usuario_nome = ANY(${bind(PORTAIS_ATIVOS)})`);

  const statuses =
    filters.statuses && filters.statuses.length > 0
      ? filters.statuses
      : (["aberta", "vai_abrir"] as const);
  conditions.push(
    `(${statuses.map((s) => `(${STATUS_PREDICATES[s]})`).join(" OR ")})`,
  );

  if (filters.ufs && filters.ufs.length > 0) {
    conditions.push(`l.uf = ANY(${bind(filters.ufs)})`);
  }
  if (filters.modalidadeIds && filters.modalidadeIds.length > 0) {
    conditions.push(`l.modalidade_id = ANY(${bind(filters.modalidadeIds)})`);
  }
  if (filters.valorMin !== undefined) {
    conditions.push(`l.valor_total_estimado >= ${bind(filters.valorMin)}`);
  }
  if (filters.valorMax !== undefined) {
    conditions.push(`l.valor_total_estimado <= ${bind(filters.valorMax)}`);
  }

  const numeros = filters.numeros ?? [];
  const temNumeros = numeros.length > 0;
  if (temNumeros) {
    conditions.push(`l.numero_controle_pncp = ANY(${bind(numeros)})`);
  }

  if (filters.q) {
    // Same expression as queries.ts, so the GIN indexes (migration 005) apply.
    const q = bind(filters.q);
    conditions.push(
      `(to_tsvector('portuguese', f_unaccent(coalesce(l.objeto_compra, '')))` +
        ` @@ websearch_to_tsquery('portuguese', f_unaccent(${q}))` +
        ` OR EXISTS (SELECT 1 FROM item i WHERE i.numero_controle_pncp = l.numero_controle_pncp` +
        ` AND to_tsvector('portuguese', f_unaccent(coalesce(i.descricao, '')))` +
        ` @@ websearch_to_tsquery('portuguese', f_unaccent(${q}))))`,
    );
  }

  // At least one signal — otherwise the whole open universe would come back.
  // Skipped when the caller asked for specific numeros (score-these-rows mode).
  if (!temNumeros) {
    conditions.push(`(
        EXISTS (
          SELECT 1 FROM licitacao_cnae lc JOIN cnaes c ON c.codigo = lc.codigo
           WHERE lc.numero_controle_pncp = l.numero_controle_pncp
        )
        OR EXISTS (
          SELECT 1 FROM unnest(${enriquecimentoTermos}) AS k
           WHERE k = ANY(${termosParam}::text[])
        )
        OR ${textoHit}${
          perfilEmbedding
            ? `\n        OR s.similaridade >= ${SEMANTIC_MIN.toFixed(2)}`
            : ""
        }
      )`);
  }

  const limitParam = bind(candidateLimit);

  const text = `
    WITH cnaes AS (
      SELECT codigo, principal FROM empresa_cnae WHERE empresa_id = $1
    )${semanticoCte}
    SELECT
      l.numero_controle_pncp,
      l.objeto_compra,
      l.orgao_razao_social,
      l.municipio_nome,
      l.uf,
      l.modalidade_nome,
      l.valor_total_estimado,
      l.data_abertura_proposta,
      l.data_encerramento_proposta,
      e.resumo,
      e.riscos,
      e.complexidade,
      (e.numero_controle_pncp IS NOT NULL) AS enriquecido,
      e.me_epp_exclusivo,
      e.exige_certificacao,
      e.exige_atestado_tecnico,
      ${cnaeHitsPrincipal} AS cnae_hits_principal,
      ${cnaeHitsSecundario} AS cnae_hits_secundario,
      ${termoHits} AS termo_hits,
      ${textoHit} AS texto_hit,
      ${exclusaoHit} AS exclusao_hit,
      ${similaridadeSelect}
    FROM licitacao l
    LEFT JOIN enriquecimento e
      ON e.numero_controle_pncp = l.numero_controle_pncp AND e.status = 'done'${semanticoJoin}
    WHERE ${conditions.join("\n      AND ")}
    ORDER BY l.data_encerramento_proposta ASC NULLS LAST
    LIMIT ${limitParam}
  `;

  return { text, values };
}

/** The empresa side of the match: profile (may be absent) + porte + the
 * perfil vector. Three statements, in this order: getPerfil, the porte
 * lookup, then `getPerfilEmbeddingText` — kept as its own query so callers
 * that only mock `getPerfil` (tools.test.ts, run.test.ts) are unaffected. */
async function loadPerfilResumo(empresaId: number): Promise<
  PerfilResumo & {
    exclusoes_termos: string[];
    embedding: string | null;
  }
> {
  const [perfil, porteResult, embedding] = await Promise.all([
    getPerfil(empresaId),
    pool.query<{ porte: string | null }>(
      `SELECT porte FROM empresa WHERE id = $1`,
      [empresaId],
    ),
    getPerfilEmbeddingText(empresaId),
  ]);
  // No empresa_perfil row → empty terms/ufs, open bounds. CNAE-only matching
  // still works, which is what a freshly-cadastrada empresa gets.
  return {
    termos: perfil?.termos ?? [],
    exclusoes_termos: perfil?.exclusoes_termos ?? [],
    ufs: perfil?.ufs ?? [],
    valor_min: perfil?.valor_min ?? null,
    valor_max: perfil?.valor_max ?? null,
    porte: porteResult.rows[0]?.porte ?? null,
    embedding,
  };
}

/** pg hands numeric expressions back as strings; anything unparseable (or
 * absent) means "no semantic signal". */
function toSimilaridade(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function tempo(data: Date | null): number {
  return data ? data.getTime() : Number.POSITIVE_INFINITY;
}

/**
 * Scored matches for one empresa. `empresaId` must always come from the
 * session — the tenant rule for this cycle.
 */
export async function fetchMatches(
  empresaId: number,
  filters: MatchFilters,
  limit = 20,
): Promise<MatchRow[]> {
  const perfil = await loadPerfilResumo(empresaId);
  const query = buildCandidateQuery(
    empresaId,
    filters,
    perfil,
    CANDIDATE_LIMIT,
    perfil.embedding,
  );
  const { rows } = await pool.query<CandidatoRow>(query.text, query.values);

  return rows
    .map((row) => {
      const { score, motivos } = scoreCandidate(
        {
          numero_controle_pncp: row.numero_controle_pncp,
          uf: row.uf,
          valor_total_estimado: row.valor_total_estimado,
          cnae_hits_principal: row.cnae_hits_principal ?? [],
          cnae_hits_secundario: row.cnae_hits_secundario ?? [],
          termo_hits: row.termo_hits ?? [],
          texto_hit: row.texto_hit === true,
          exclusao_hit: row.exclusao_hit === true,
          me_epp_exclusivo: row.me_epp_exclusivo,
          exige_certificacao: row.exige_certificacao,
          exige_atestado_tecnico: row.exige_atestado_tecnico,
          similaridade: toSimilaridade(row.similaridade),
        },
        perfil,
      );
      return {
        numero_controle_pncp: row.numero_controle_pncp,
        objeto_compra: row.objeto_compra,
        orgao_razao_social: row.orgao_razao_social,
        municipio_nome: row.municipio_nome,
        uf: row.uf,
        modalidade_nome: row.modalidade_nome,
        valor_total_estimado: row.valor_total_estimado,
        data_abertura_proposta: row.data_abertura_proposta,
        data_encerramento_proposta: row.data_encerramento_proposta,
        resumo: row.resumo,
        riscos: row.riscos,
        complexidade: row.complexidade,
        enriquecido: row.enriquecido,
        score,
        motivos,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        tempo(a.data_encerramento_proposta) - tempo(b.data_encerramento_proposta),
    )
    .slice(0, limit);
}
