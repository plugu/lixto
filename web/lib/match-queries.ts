// Candidate retrieval for the match engine on the lixto schema. One statement
// gathers the facts (CNAE overlap via `procurement_cnaes` × `company_cnaes`,
// enrichment-keyword intersection, FTS hits, the enrichment flags, the
// pgvector similarity); scoring and ordering happen in TS via `scoreCandidate`
// — see match-engine.ts.
//
// On demand, nothing written to `matches`: a profile edited a second ago is
// already reflected. Every value from the outside world (companyId, filters,
// the tsquery strings) is bound as $n — never string-interpolated into SQL.

import { pool } from "./db";
import { scoreCandidate, type Reason, type ProfileSummary } from "./match-engine";
import { ACTIVE_PORTALS } from "./portals";
import {
  getProfile,
  getProfileEmbeddingText,
  type SqlQuery,
} from "./profile-queries";
import type { ProcurementStatus } from "./status";

export type MatchFilters = {
  q?: string;
  states?: string[];
  statuses?: ProcurementStatus[];
  modalityIds?: number[];
  valueMin?: number;
  valueMax?: number;
  /** "Score exactly these" mode: `procurements.source_id` values. */
  sourceIds?: string[];
  /** Batch mode (match-batch.ts): only procurements whose enrichment landed
   * after this instant. Implies "enriched": the LEFT JOIN on
   * `procurement_enrichments` becomes effectively an inner join for this run. */
  enrichedSince?: Date;
};

export type MatchRow = {
  source_id: string;
  description: string | null;
  agency_name: string | null;
  city_name: string | null;
  state: string | null;
  modality_name: string | null;
  estimated_value: string | null;
  proposal_opens_at: Date | null;
  proposal_closes_at: Date | null;
  summary: string | null;
  risks: string[] | null;
  complexity: string | null;
  enriched: boolean;
  score: number;
  reasons: Reason[];
};

/** Row shape returned by `buildCandidateQuery`, before scoring. */
export type CandidateRow = Omit<MatchRow, "score" | "reasons"> & {
  cnae_hits_primary: string[] | null;
  cnae_hits_secondary: string[] | null;
  term_hits: string[] | null;
  text_hit: boolean | null;
  exclusion_hit: boolean | null;
  me_epp_exclusive: boolean | null;
  requires_certification: boolean | null;
  requires_technical_certificate: boolean | null;
  /** pg returns numeric expressions as strings unless a type parser says
   * otherwise; normalized with Number() before scoring. */
  similarity: string | number | null;
};

/** How many rows the SQL side hands to the scorer. Scoring is cheap; the DB
 * scan is not, so this is the real cost knob. */
const CANDIDATE_LIMIT = 200;

/** Rows the pgvector nearest-neighbour scan contributes as candidates. */
const SEMANTIC_TOP_K = 200;

/** Minimum cosine similarity that counts as a signal on its own — same floor
 * as the weakest band in match-engine.ts. */
const SEMANTIC_MIN = 0.4;

// Same predicates as `computeProcurementStatus` / procurement-queries.ts,
// parameterised by alias: `p` for the outer query, `sp` inside the semantic
// CTE, so the same open/upcoming scope applies to both.
const STATUS_PREDICATES: Record<ProcurementStatus, (alias: string) => string> = {
  open: (a) => `${a}.proposal_opens_at <= now() AND now() < ${a}.proposal_closes_at`,
  upcoming: (a) => `${a}.proposal_opens_at > now()`,
  closed: (a) => `(${a}.proposal_closes_at < now() OR ${a}.proposal_closes_at IS NULL)`,
};

/** ORs the given statuses' predicates together, aliased to `alias` (`p` in
 * the outer WHERE, `sp` inside the semantic CTE — the same scope both
 * places, so semantic top-K slots aren't spent on rows the batch would
 * discard anyway). */
function buildStatusPredicate(
  alias: string,
  statuses: readonly ProcurementStatus[],
): string {
  return `(${statuses.map((s) => `(${STATUS_PREDICATES[s](alias)})`).join(" OR ")})`;
}

/**
 * Turns normalized profile terms into one `to_tsquery` input:
 * `["lapis", "lapis preto"]` → `"(lapis) | (lapis & preto)"`.
 * Each term is sanitized to `[a-z0-9 ]` first, so nothing a user typed can
 * reach the tsquery parser as an operator. Empty list → null (the caller
 * binds it and the predicate collapses to false).
 */
export function buildTermsTsQuery(terms: string[]): string | null {
  const parts = terms
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
  return parts.length === 0 ? null : parts.join(" | ");
}

/**
 * The single candidate statement. `companyId` is always $1. `profile` comes in
 * as an argument (already loaded by `fetchMatches`) rather than being read via
 * a CTE, so this stays pure and testable — the profile values it needs are all
 * bound as parameters.
 */
export function buildCandidateQuery(
  companyId: number,
  filters: MatchFilters,
  profile: ProfileSummary & { exclusion_terms: string[] },
  candidateLimit: number,
  profileEmbedding?: string | null,
): SqlQuery {
  const values: unknown[] = [companyId];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  const termsParam = bind(profile.terms);
  const tqParam = bind(buildTermsTsQuery(profile.terms));
  const exclusionTqParam = bind(buildTermsTsQuery(profile.exclusion_terms));

  // A NULL tsquery would make the whole comparison NULL; the CASE keeps it a
  // plain false so the "at least one signal" predicate stays sargable.
  //
  // Written as `description @@ q` OR-ed with `EXISTS (items @@ q)`, that OR keeps the
  // planner off both GIN expression indexes (`idx_procurements_description_fts`,
  // `idx_procurement_items_description_fts`): it walks every row in scope
  // recomputing `to_tsvector(f_unaccent(...))`, ~5 s per query on prod. As a
  // UNION of two id sets each branch is one bitmap index scan instead — same
  // fix as `buildQPredicate` in procurement-queries.ts. The expressions must
  // stay textually identical to the index definitions to be matched.
  const ftsHit = (param: string) => `(CASE WHEN ${param}::text IS NULL THEN false ELSE (
        p.id IN (
          SELECT kw_p.id FROM procurements kw_p
           WHERE to_tsvector('portuguese', f_unaccent(coalesce(kw_p.description, '')))
                 @@ to_tsquery('portuguese', f_unaccent(${param}::text))
          UNION
          SELECT kw_i.procurement_id FROM procurement_items kw_i
           WHERE to_tsvector('portuguese', f_unaccent(coalesce(kw_i.description, '')))
                 @@ to_tsquery('portuguese', f_unaccent(${param}::text))
        )
      ) END)`;

  const textHit = ftsHit(tqParam);
  const exclusionHit = ftsHit(exclusionTqParam);

  const cnaeHitsPrimary = `ARRAY(
        SELECT pc.cnae_code FROM procurement_cnaes pc
          JOIN company_codes c ON c.cnae_code = pc.cnae_code AND c.is_primary
         WHERE pc.procurement_id = p.id
      )`;
  const cnaeHitsSecondary = `ARRAY(
        SELECT pc.cnae_code FROM procurement_cnaes pc
          JOIN company_codes c ON c.cnae_code = pc.cnae_code AND NOT c.is_primary
         WHERE pc.procurement_id = p.id
      )`;
  const enrichmentTerms = `(coalesce(e.keywords, '{}'::text[]) || coalesce(e.concepts, '{}'::text[]))`;
  const termHits = `ARRAY(
        SELECT unnest(${enrichmentTerms})
        INTERSECT
        SELECT unnest(${termsParam}::text[])
      )`;

  // Portal allowlist + status scope: bound/built once, reused for the outer
  // WHERE (aliased `p`) and the semantic CTE (aliased `sp`) — same $n for the
  // allowlist in both places. Without this, the semantic top-K spends its
  // slots on closed or off-portal rows the outer WHERE would discard anyway,
  // starving the K nearest neighbours that could actually be candidates.
  const activePortalsParam = bind(ACTIVE_PORTALS);
  const statuses =
    filters.statuses && filters.statuses.length > 0
      ? filters.statuses
      : (["open", "upcoming"] as const);
  const statusPredicate = buildStatusPredicate("p", statuses);

  // Semantic top-K: an extra candidate source, so a procurement for "cadernos
  // e apontadores" reaches a company selling "material escolar" with zero
  // keyword overlap. The vector is bound as text and cast — node-pg has no
  // vector type — and the CTE is skipped entirely when the profile has no
  // embedding yet.
  const semanticCte = profileEmbedding
    ? (() => {
        const v = bind(profileEmbedding);
        return `,
    semantic AS (
      SELECT procurement_id,
             1 - (embedding <=> ${v}::vector) AS similarity
        FROM procurement_embeddings
        JOIN procurements sp ON sp.id = procurement_embeddings.procurement_id
       WHERE sp.origin_system = ANY(${activePortalsParam})
         AND ${buildStatusPredicate("sp", statuses)}
       ORDER BY embedding <=> ${v}::vector
       LIMIT ${SEMANTIC_TOP_K}
    )`;
      })()
    : "";
  const semanticJoin = profileEmbedding
    ? `\n    LEFT JOIN semantic s ON s.procurement_id = p.id`
    : "";
  const similaritySelect = profileEmbedding
    ? "s.similarity"
    : "NULL::real AS similarity";

  const conditions: string[] = [];

  // Platform-wide top-7 portal allowlist: always applied. Same bound param
  // as the semantic CTE's `sp.origin_system` above.
  conditions.push(`p.origin_system = ANY(${activePortalsParam})`);

  conditions.push(statusPredicate);

  if (filters.enrichedSince) {
    conditions.push(`e.enriched_at > ${bind(filters.enrichedSince)}`);
  }
  if (filters.states && filters.states.length > 0) {
    conditions.push(`p.state = ANY(${bind(filters.states)})`);
  }
  if (filters.modalityIds && filters.modalityIds.length > 0) {
    conditions.push(`p.modality_id = ANY(${bind(filters.modalityIds)})`);
  }
  if (filters.valueMin !== undefined) {
    conditions.push(`p.estimated_value >= ${bind(filters.valueMin)}`);
  }
  if (filters.valueMax !== undefined) {
    conditions.push(`p.estimated_value <= ${bind(filters.valueMax)}`);
  }

  const sourceIds = filters.sourceIds ?? [];
  const hasSourceIds = sourceIds.length > 0;
  if (hasSourceIds) {
    conditions.push(`p.source_id = ANY(${bind(sourceIds)})`);
  }

  if (filters.q) {
    // Same UNION shape as `buildQPredicate` in procurement-queries.ts, so the
    // GIN indexes apply instead of an OR-EXISTS seq scan.
    const q = bind(filters.q);
    conditions.push(
      `p.id IN (` +
        `SELECT kw_p.id FROM procurements kw_p` +
        ` WHERE to_tsvector('portuguese', f_unaccent(coalesce(kw_p.description, '')))` +
        ` @@ websearch_to_tsquery('portuguese', f_unaccent(${q}))` +
        ` UNION ` +
        `SELECT kw_i.procurement_id FROM procurement_items kw_i` +
        ` WHERE to_tsvector('portuguese', f_unaccent(coalesce(kw_i.description, '')))` +
        ` @@ websearch_to_tsquery('portuguese', f_unaccent(${q}))` +
        `)`,
    );
  }

  // At least one signal — otherwise the whole open universe would come back.
  // Skipped when the caller asked for specific sourceIds (score-these-rows).
  if (!hasSourceIds) {
    conditions.push(`(
        EXISTS (
          SELECT 1 FROM procurement_cnaes pc JOIN company_codes c ON c.cnae_code = pc.cnae_code
           WHERE pc.procurement_id = p.id
        )
        OR
        EXISTS (
          SELECT 1 FROM unnest(${enrichmentTerms}) AS k
           WHERE k = ANY(${termsParam}::text[])
        )
        OR ${textHit}${
          profileEmbedding
            ? `\n        OR s.similarity >= ${SEMANTIC_MIN.toFixed(2)}`
            : ""
        }
      )`);
  }

  const limitParam = bind(candidateLimit);

  const text = `
    WITH company_codes AS (
      SELECT cnae_code, is_primary FROM company_cnaes WHERE company_id = $1
    )${semanticCte}
    SELECT
      p.source_id,
      p.description,
      a.name AS agency_name,
      p.city_name,
      p.state,
      p.modality_name,
      p.estimated_value,
      p.proposal_opens_at,
      p.proposal_closes_at,
      e.summary,
      e.risks,
      e.complexity,
      (e.procurement_id IS NOT NULL) AS enriched,
      e.me_epp_exclusive,
      e.requires_certification,
      e.requires_technical_certificate,
      ${cnaeHitsPrimary} AS cnae_hits_primary,
      ${cnaeHitsSecondary} AS cnae_hits_secondary,
      ${termHits} AS term_hits,
      ${textHit} AS text_hit,
      ${exclusionHit} AS exclusion_hit,
      ${similaritySelect}
    FROM procurements p
    JOIN agencies a ON a.tax_id = p.agency_tax_id
    LEFT JOIN procurement_enrichments e
      ON e.procurement_id = p.id AND e.status = 'done'${semanticJoin}
    WHERE ${conditions.join("\n      AND ")}
    ORDER BY p.proposal_closes_at ASC NULLS LAST
    LIMIT ${limitParam}
  `;

  return { text, values };
}

/** The company side of the match: profile (may be absent) + size + the
 * profile vector. Three statements, in this order: getProfile, the size
 * lookup, then `getProfileEmbeddingText` — kept as its own query so callers
 * that only mock `getProfile` (tools.test.ts, run.test.ts) are unaffected. */
async function loadProfileSummary(companyId: number): Promise<
  ProfileSummary & {
    exclusion_terms: string[];
    embedding: string | null;
  }
> {
  const [profile, sizeResult, embedding] = await Promise.all([
    getProfile(companyId),
    pool.query<{ size: string | null }>(
      `SELECT size FROM companies WHERE id = $1`,
      [companyId],
    ),
    getProfileEmbeddingText(companyId),
  ]);
  // No company_profiles row → empty terms/states, open bounds. CNAE-only
  // matching still works, which is what a freshly signed-up company gets.
  return {
    terms: profile?.terms ?? [],
    exclusion_terms: profile?.exclusion_terms ?? [],
    states: profile?.states ?? [],
    min_value: profile?.min_value ?? null,
    max_value: profile?.max_value ?? null,
    size: sizeResult.rows[0]?.size ?? null,
    embedding,
  };
}

/** pg hands numeric expressions back as strings; anything unparseable (or
 * absent) means "no semantic signal". */
function toSimilarity(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function time(date: Date | null): number {
  return date ? date.getTime() : Number.POSITIVE_INFINITY;
}

/**
 * Scored matches for one company. `companyId` must always come from the
 * session — the tenant golden rule. `candidateLimit` is the SQL-side cap; the
 * batch (match-batch.ts) raises it, interactive callers keep the default.
 */
export async function fetchMatches(
  companyId: number,
  filters: MatchFilters,
  limit = 20,
  candidateLimit = CANDIDATE_LIMIT,
): Promise<MatchRow[]> {
  const profile = await loadProfileSummary(companyId);
  const query = buildCandidateQuery(
    companyId,
    filters,
    profile,
    candidateLimit,
    profile.embedding,
  );
  const { rows } = await pool.query<CandidateRow>(query.text, query.values);

  return rows
    .map((row) => {
      const { score, reasons } = scoreCandidate(
        {
          source_id: row.source_id,
          state: row.state,
          estimated_value: row.estimated_value,
          cnae_hits_primary: row.cnae_hits_primary ?? [],
          cnae_hits_secondary: row.cnae_hits_secondary ?? [],
          term_hits: row.term_hits ?? [],
          text_hit: row.text_hit === true,
          exclusion_hit: row.exclusion_hit === true,
          me_epp_exclusive: row.me_epp_exclusive,
          requires_certification: row.requires_certification,
          requires_technical_certificate: row.requires_technical_certificate,
          similarity: toSimilarity(row.similarity),
        },
        profile,
      );
      return {
        source_id: row.source_id,
        description: row.description,
        agency_name: row.agency_name,
        city_name: row.city_name,
        state: row.state,
        modality_name: row.modality_name,
        estimated_value: row.estimated_value,
        proposal_opens_at: row.proposal_opens_at,
        proposal_closes_at: row.proposal_closes_at,
        summary: row.summary,
        risks: row.risks,
        complexity: row.complexity,
        enriched: row.enriched,
        score,
        reasons,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        time(a.proposal_closes_at) - time(b.proposal_closes_at),
    )
    .slice(0, limit);
}
