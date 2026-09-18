// SQL builder for the /procurements list page: search + filters + facets.
//
// Every value from the outside world (q, portal, modality id) is bound as a
// parameterized placeholder — never string-interpolated into SQL text.
//
// Status filtering uses the same predicates as `computeProcurementStatus`
// in lib/status.ts, expressed on `proposal_opens_at` / `proposal_closes_at`
// (docs/adr/001-lixto-data-model.md, D3).

import { pool } from "./db";
import { ACTIVE_PORTALS } from "./portals";
import { STATUS_LABELS, type ProcurementStatus } from "./status";

/** Derived from the itens' `kind` (material/service), same rule the legacy
 * "categoria" filter used: all material = product, all service = service,
 * both = mixed. */
export type ProcurementKind = "product" | "service" | "mixed";

/** Explicit list orderings. Absent = the default: status group + date on the
 * plain path, fused relevance rank on the hybrid (q + embedding) path. */
export const PROCUREMENT_SORTS = [
  "closing_asc",
  "published_desc",
  "value_desc",
  "value_asc",
] as const;

export type ProcurementSort = (typeof PROCUREMENT_SORTS)[number];

export function isProcurementSort(value: unknown): value is ProcurementSort {
  return (PROCUREMENT_SORTS as readonly unknown[]).includes(value);
}

export type ProcurementFilters = {
  q?: string;
  /** `origin_system` — the portal that published the procurement. */
  portals?: string[];
  modalityIds?: number[];
  statuses?: ProcurementStatus[];
  kind?: ProcurementKind;
  /** `procurement_categories.category` (from enrichment) — replaces the
   * legacy Ollama `setor` facet. */
  categories?: string[];
  states?: string[];
  valueMin?: number;
  valueMax?: number;
  /** "Compatível com minha empresa": `procurement_cnaes` ∩ `company_cnaes`.
   * Only meaningful when the caller also supplies the logged-in company's
   * CNAE codes — with no codes the filter is ignored. */
  compat?: boolean;
  /** Explicit ordering; not a predicate (never touches WHERE, counts or
   * facets), only `buildListQuery`'s ORDER BY. */
  sort?: ProcurementSort;
};

/** The five filter dimensions with per-option facet counts. */
type MultiFilterKey =
  | "modalityIds"
  | "categories"
  | "portals"
  | "statuses"
  | "states";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

export type FacetOption = {
  value: string | number;
  label: string;
  count: number;
};

export type FacetCounts = {
  modality: FacetOption[];
  category: FacetOption[];
  portal: FacetOption[];
  status: FacetOption[];
  state: FacetOption[];
};

const HAS_MATERIAL =
  "EXISTS (SELECT 1 FROM procurement_items i WHERE i.procurement_id = procurements.id AND i.kind = 'material')";
const HAS_SERVICE =
  "EXISTS (SELECT 1 FROM procurement_items i WHERE i.procurement_id = procurements.id AND i.kind = 'service')";

const KIND_PREDICATES: Record<ProcurementKind, string> = {
  product: `(${HAS_MATERIAL} AND NOT ${HAS_SERVICE})`,
  service: `(${HAS_SERVICE} AND NOT ${HAS_MATERIAL})`,
  mixed: `(${HAS_MATERIAL} AND ${HAS_SERVICE})`,
};

const STATUS_PREDICATES: Record<ProcurementStatus, string> = {
  open: "proposal_opens_at <= now() AND now() < proposal_closes_at",
  upcoming: "proposal_opens_at > now()",
  closed: "(proposal_closes_at < now() OR proposal_closes_at IS NULL)",
};

// --- hybrid (keyword ∪ semantic) retrieval knobs -------------------------
// Same values as match-queries.ts, deliberately *not* imported from it: the
// match engine and free-text search are free to tune them independently.

/** Rows the pgvector nearest-neighbour scan contributes as candidates. */
export const SEARCH_SEMANTIC_TOP_K = 200;

/** Minimum cosine similarity for a row that only the vector branch found —
 * below this, a semantic-only hit is noise and is dropped. */
export const SEARCH_SEMANTIC_MIN = 0.4;

/** Reciprocal-rank-fusion damping constant: `1/(RRF_K + rank)`. The standard
 * 60 — high enough that the top of each list doesn't dominate the other. */
export const RRF_K = 60;

/** The free-text predicate: FTS over the procurement description or any of its
 * items, unaccented on both sides (migration 001) so "lapis" matches "lápis".
 * `idx` is the 1-based position of the already-bound `q` parameter. */
function buildQPredicate(idx: number): string {
  return (
    `(to_tsvector('portuguese', f_unaccent(coalesce(description, ''))) @@ websearch_to_tsquery('portuguese', f_unaccent($${idx}))` +
    ` OR EXISTS (` +
    `SELECT 1 FROM procurement_items i` +
    ` WHERE i.procurement_id = procurements.id` +
    ` AND to_tsvector('portuguese', f_unaccent(coalesce(i.description, ''))) @@ websearch_to_tsquery('portuguese', f_unaccent($${idx}))` +
    `))`
  );
}

/** Parses raw (possibly array-valued, from Next's searchParams) query values
 * into typed filters. Repeated params (`?modality=6&modality=8`) arrive as
 * arrays already; a single occurrence arrives as a bare string, normalized
 * into a one-element array. Unknown/invalid values are dropped rather than
 * throwing, so a malformed URL just falls back to "no filter" for that
 * field. */
export function parseFilters(
  raw: Record<string, string | string[] | undefined>,
): ProcurementFilters {
  const filters: ProcurementFilters = {};

  const q = firstValue(raw.q)?.trim();
  if (q) filters.q = q;

  const portals = allValues(raw.portal);
  if (portals.length > 0) filters.portals = portals;

  const modalityIds = allValues(raw.modality)
    .map((v) => Number.parseInt(v, 10))
    .filter((v) => Number.isInteger(v));
  if (modalityIds.length > 0) filters.modalityIds = modalityIds;

  const statuses = allValues(raw.status).filter(
    (v): v is ProcurementStatus =>
      v === "open" || v === "upcoming" || v === "closed",
  );
  if (statuses.length > 0) filters.statuses = statuses;

  const kind = firstValue(raw.kind)?.trim();
  if (kind === "product" || kind === "service" || kind === "mixed") {
    filters.kind = kind;
  }

  const categories = allValues(raw.category);
  if (categories.length > 0) filters.categories = categories;

  const states = allValues(raw.state)
    .map((v) => v.toUpperCase())
    .filter((v) => /^[A-Z]{2}$/.test(v));
  if (states.length > 0) filters.states = states;

  const valueMin = parseValue(firstValue(raw.valueMin));
  if (valueMin !== undefined) filters.valueMin = valueMin;

  const valueMax = parseValue(firstValue(raw.valueMax));
  if (valueMax !== undefined) filters.valueMax = valueMax;

  if (firstValue(raw.compat) === "1") filters.compat = true;

  const sort = firstValue(raw.sort)?.trim();
  if (isProcurementSort(sort)) filters.sort = sort;

  return filters;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Normalizes a possibly-repeated, possibly-absent param into a list of
 * trimmed, non-empty values (a single string becomes a one-element array). */
function allValues(value: string | string[] | undefined): string[] {
  const arr = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return arr.map((v) => v.trim()).filter((v) => v.length > 0);
}

function parseValue(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Builds the WHERE conditions + params shared by the list, count and facet
 * queries. `exclude`, when given, skips that one multi-select dimension's own
 * predicate — standard faceting, so a dimension's own selection never narrows
 * its own per-option counts. `omitQ` leaves the free-text predicate out (and
 * leaves `q` unbound), which is what the hybrid path wants: there the FTS
 * predicate lives in the `kw` CTE, not in the structured filters. `values`
 * starts at $1; callers append further params (limit/offset) after. */
function buildFilterConditions(
  filters: ProcurementFilters,
  exclude?: MultiFilterKey,
  omitQ = false,
): { conditions: string[]; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];

  // Platform-wide top-7 portal allowlist: always applied, even with no user
  // filters, so the WHERE clause is never empty.
  values.push(ACTIVE_PORTALS);
  conditions.push(`origin_system = ANY($${values.length})`);

  if (filters.q && !omitQ) {
    values.push(filters.q);
    conditions.push(buildQPredicate(values.length));
  }

  if (exclude !== "portals" && filters.portals && filters.portals.length > 0) {
    // Applied alongside (intersected with) the allowlist above.
    values.push(filters.portals);
    conditions.push(`origin_system = ANY($${values.length})`);
  }

  if (
    exclude !== "modalityIds" &&
    filters.modalityIds &&
    filters.modalityIds.length > 0
  ) {
    values.push(filters.modalityIds);
    conditions.push(`modality_id = ANY($${values.length})`);
  }

  if (exclude !== "statuses" && filters.statuses && filters.statuses.length > 0) {
    // Multiple statuses OR-combine (e.g. open OR upcoming).
    const predicates = filters.statuses.map((s) => `(${STATUS_PREDICATES[s]})`);
    conditions.push(`(${predicates.join(" OR ")})`);
  }

  if (filters.kind) {
    conditions.push(KIND_PREDICATES[filters.kind]);
  }

  if (
    exclude !== "categories" &&
    filters.categories &&
    filters.categories.length > 0
  ) {
    values.push(filters.categories);
    conditions.push(
      `EXISTS (SELECT 1 FROM procurement_categories pc WHERE pc.procurement_id = procurements.id AND pc.category = ANY($${values.length}))`,
    );
  }

  if (exclude !== "states" && filters.states && filters.states.length > 0) {
    values.push(filters.states);
    conditions.push(`state = ANY($${values.length})`);
  }

  if (filters.valueMin !== undefined) {
    values.push(filters.valueMin);
    conditions.push(`estimated_value >= $${values.length}`);
  }

  if (filters.valueMax !== undefined) {
    values.push(filters.valueMax);
    conditions.push(`estimated_value <= $${values.length}`);
  }

  return { conditions, values };
}

/** Builds the `compat` predicate: an EXISTS against `procurement_cnaes` for
 * any of the logged-in company's CNAE codes. Returns null when the filter
 * isn't active or no codes were supplied (`compat=1` with no session, or a
 * company with zero CNAEs, both no-ops). Used only by buildWhereClause (list
 * + count queries) — the facet-count queries are untouched. */
function buildCompatPredicate(
  filters: ProcurementFilters,
  companyCnaes: string[] | undefined,
  values: unknown[],
): string | null {
  if (!filters.compat) return null;
  if (!companyCnaes || companyCnaes.length === 0) return null;

  values.push(companyCnaes);
  return `EXISTS (SELECT 1 FROM procurement_cnaes pc WHERE pc.procurement_id = procurements.id AND pc.cnae_code = ANY($${values.length}))`;
}

/** Builds the WHERE clause + params shared by the list and count queries.
 * `values` starts at $1; callers append further params (limit/offset) after.
 * `companyCnaes` is the logged-in company's CNAE codes, threaded from the
 * page — omit/empty when logged out or the filter is a no-op. */
export function buildWhereClause(
  filters: ProcurementFilters,
  companyCnaes?: string[],
): {
  where: string;
  values: unknown[];
} {
  const { conditions, values } = buildScopeConditions(filters, companyCnaes);
  return { where: `WHERE ${conditions.join(" AND ")}`, values };
}

/** Filter + compat predicates as a list, so the hybrid path can splice them
 * into two different FROM clauses (`kw` and `sem`) instead of one WHERE. */
function buildScopeConditions(
  filters: ProcurementFilters,
  companyCnaes: string[] | undefined,
  omitQ = false,
): { conditions: string[]; values: unknown[] } {
  const { conditions, values } = buildFilterConditions(
    filters,
    undefined,
    omitQ,
  );
  const compatPredicate = buildCompatPredicate(filters, companyCnaes, values);
  if (compatPredicate) conditions.push(compatPredicate);
  return { conditions, values };
}

/** Should this call take the hybrid (FTS ∪ pgvector) path? Only when there is
 * free text *and* the caller managed to embed it — an embedder outage falls
 * back to the keyword-only path rather than failing the search. */
function isHybrid(
  filters: ProcurementFilters,
  qEmbedding: string | null | undefined,
): qEmbedding is string {
  return Boolean(filters.q) && Boolean(qEmbedding);
}

/**
 * The three CTEs of the hybrid candidate set, plus the structured WHERE the
 * list query re-applies to `procurements`:
 *
 * - `kw`  — FTS hits, ranked by `ts_rank`;
 * - `sem` — the pgvector top-K by cosine distance;
 * - `fused` — their union, scored by reciprocal-rank fusion.
 *
 * The structured filters (portal, UF, modalidade, faixa de valor, situação,
 * compat) are applied inside *both* branches, so a semantic hit can never
 * escape the user's hard filters. The vector is bound as text and cast —
 * node-pg has no vector type.
 */
function buildHybridCtes(
  filters: ProcurementFilters,
  companyCnaes: string[] | undefined,
  qEmbedding: string,
): { ctes: string; where: string; values: unknown[] } {
  const { conditions, values } = buildScopeConditions(filters, companyCnaes, true);
  const structured = conditions.join(" AND ");

  values.push(filters.q);
  const qIdx = values.length;
  values.push(qEmbedding);
  const v = `$${values.length}::vector`;

  const rank = `ts_rank(to_tsvector('portuguese', f_unaccent(coalesce(description, ''))), websearch_to_tsquery('portuguese', f_unaccent($${qIdx})))`;

  const ctes = `kw AS (
      SELECT procurements.id,
             row_number() OVER (ORDER BY ${rank} DESC, id) AS rank
        FROM procurements
       WHERE ${structured}
         AND ${buildQPredicate(qIdx)}
    ),
    sem AS (
      SELECT pe.procurement_id AS id,
             1 - (pe.embedding <=> ${v}) AS similarity,
             row_number() OVER (ORDER BY pe.embedding <=> ${v}) AS rank
        FROM procurement_embeddings pe
        JOIN procurements ON procurements.id = pe.procurement_id
       WHERE ${structured}
       ORDER BY pe.embedding <=> ${v}
       LIMIT ${SEARCH_SEMANTIC_TOP_K}
    ),
    fused AS (
      SELECT
        id,
        coalesce(1.0 / (${RRF_K} + kw.rank), 0) + coalesce(1.0 / (${RRF_K} + sem.rank), 0) AS rrf,
        sem.similarity AS similarity,
        CASE
          WHEN kw.id IS NOT NULL AND sem.id IS NOT NULL THEN 'both'
          WHEN kw.id IS NOT NULL THEN 'keyword'
          ELSE 'semantic'
        END AS match_kind
      FROM kw FULL OUTER JOIN sem USING (id)
      -- A vector-only hit below the floor is noise; a keyword hit always stays.
      WHERE kw.id IS NOT NULL OR sem.similarity >= ${SEARCH_SEMANTIC_MIN}
    )`;

  return { ctes, where: `WHERE ${structured}`, values };
}

/** Column list of the `classified` CTE, shared by both list paths. */
const CLASSIFIED_COLUMNS = `procurements.source_id,
        procurements.description,
        agencies.name AS agency_name,
        procurements.city_name,
        procurements.state,
        procurements.modality_name,
        procurements.estimated_value,
        procurements.proposal_opens_at,
        procurements.proposal_closes_at,
        procurements.published_at,
        (e.procurement_id IS NOT NULL) AS enriched,
        CASE
          WHEN proposal_opens_at <= now() AND now() < proposal_closes_at THEN 0
          WHEN proposal_opens_at > now() THEN 1
          ELSE 2
        END AS status_group,
        CASE
          WHEN proposal_opens_at <= now() AND now() < proposal_closes_at
            THEN extract(epoch FROM proposal_closes_at)
          WHEN proposal_opens_at > now()
            THEN extract(epoch FROM proposal_opens_at)
          ELSE -extract(epoch FROM coalesce(
            proposal_closes_at, published_at, '-infinity'::timestamptz
          ))
        END AS sort_val`;

const CLASSIFIED_FROM = `FROM procurements
      JOIN agencies ON agencies.tax_id = procurements.agency_tax_id
      LEFT JOIN procurement_enrichments e
        ON e.procurement_id = procurements.id AND e.status = 'done'`;

/** ORDER BY for an explicit sort. Every column is one of the `classified`
 * CTE's own, so the same clause serves both list paths; `source_id` breaks
 * ties so pagination is stable. Sort keys are a closed enum, never
 * interpolated from user input. */
const SORT_ORDER_BY: Record<ProcurementSort, string> = {
  // Deadlines still ahead first (soonest on top), then the ones already
  // passed — a bare column sort would open with years-old closed tenders.
  closing_asc:
    "ORDER BY CASE WHEN proposal_closes_at >= now() THEN 0 ELSE 1 END, proposal_closes_at ASC NULLS LAST, source_id",
  published_desc: "ORDER BY published_at DESC NULLS LAST, source_id",
  value_desc: "ORDER BY estimated_value DESC NULLS LAST, source_id",
  value_asc: "ORDER BY estimated_value ASC NULLS LAST, source_id",
};

// Default ordering: open closing soonest, then upcoming opening soonest, then
// closed newest first — except on the hybrid path, where relevance (the fused
// rank) decides and the date ordering would bury the semantic hits. An
// explicit `filters.sort` overrides both.
export function buildListQuery(
  filters: ProcurementFilters,
  limit: number,
  offset: number,
  companyCnaes?: string[],
  qEmbedding?: string | null,
): SqlQuery {
  if (isHybrid(filters, qEmbedding)) {
    const { ctes, where, values } = buildHybridCtes(
      filters,
      companyCnaes,
      qEmbedding,
    );
    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;

    const text = `
    WITH ${ctes},
    classified AS (
      SELECT
        procurements.id,
        ${CLASSIFIED_COLUMNS}
      ${CLASSIFIED_FROM}
      ${where}
    )
    SELECT
      source_id, description, agency_name, city_name, state,
      modality_name, estimated_value, proposal_opens_at, proposal_closes_at,
      enriched, fused.match_kind, fused.similarity
    FROM classified
    JOIN fused ON fused.id = classified.id
    ${filters.sort ? SORT_ORDER_BY[filters.sort] : "ORDER BY fused.rrf DESC, source_id"}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

    return { text, values: [...values, limit, offset] };
  }

  const { where, values } = buildWhereClause(filters, companyCnaes);
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;

  const text = `
    WITH classified AS (
      SELECT
        ${CLASSIFIED_COLUMNS}
      ${CLASSIFIED_FROM}
      ${where}
    )
    SELECT
      source_id, description, agency_name, city_name, state,
      modality_name, estimated_value, proposal_opens_at, proposal_closes_at,
      enriched, NULL::text AS match_kind, NULL::real AS similarity
    FROM classified
    ${filters.sort ? SORT_ORDER_BY[filters.sort] : "ORDER BY status_group ASC, sort_val ASC NULLS LAST"}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  return { text, values: [...values, limit, offset] };
}

export function buildCountQuery(
  filters: ProcurementFilters,
  companyCnaes?: string[],
  qEmbedding?: string | null,
): SqlQuery {
  if (isHybrid(filters, qEmbedding)) {
    const { ctes, values } = buildHybridCtes(filters, companyCnaes, qEmbedding);
    return {
      text: `
    WITH ${ctes}
    SELECT count(*)::text AS count FROM fused
  `,
      values,
    };
  }

  const { where, values } = buildWhereClause(filters, companyCnaes);
  return {
    text: `SELECT count(*)::text AS count FROM procurements ${where}`,
    values,
  };
}

export function buildPortalOptionsQuery(): SqlQuery {
  return {
    text: `SELECT DISTINCT origin_system AS portal FROM procurements WHERE origin_system = ANY($1) ORDER BY 1`,
    values: [ACTIVE_PORTALS],
  };
}

export function buildModalityOptionsQuery(): SqlQuery {
  return {
    text:
      `SELECT DISTINCT modality_id, modality_name FROM procurements` +
      ` WHERE modality_id IS NOT NULL AND modality_name IS NOT NULL` +
      ` ORDER BY modality_name`,
    values: [],
  };
}

// Facet-count queries: for each of the 5 multi-select dimensions, a grouped
// count applying every active filter EXCEPT that dimension's own selection
// (standard faceting), so picking one option never zeroes out the others'
// counts.

export function buildModalityFacetQuery(filters: ProcurementFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "modalityIds");
  const where = [
    ...conditions,
    "modality_id IS NOT NULL",
    "modality_name IS NOT NULL",
  ].join(" AND ");
  return {
    text: `
      SELECT modality_id AS value, modality_name AS label, count(*)::text AS count
      FROM procurements
      WHERE ${where}
      GROUP BY modality_id, modality_name
      ORDER BY count(*) DESC
    `,
    values,
  };
}

export function buildCategoryFacetQuery(filters: ProcurementFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "categories");
  const where = conditions.join(" AND ");
  return {
    text: `
      SELECT c.category AS value, c.category AS label, count(*)::text AS count
      FROM procurements
      JOIN procurement_categories c ON c.procurement_id = procurements.id
      WHERE ${where}
      GROUP BY c.category
      ORDER BY count(*) DESC
    `,
    values,
  };
}

export function buildPortalFacetQuery(filters: ProcurementFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "portals");
  const where = conditions.join(" AND ");
  return {
    text: `
      SELECT origin_system AS value, origin_system AS label, count(*)::text AS count
      FROM procurements
      WHERE ${where}
      GROUP BY origin_system
      ORDER BY count(*) DESC
    `,
    values,
  };
}

export function buildStatusFacetQuery(filters: ProcurementFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "statuses");
  const where = conditions.join(" AND ");
  return {
    text: `
      SELECT
        count(*) FILTER (WHERE ${STATUS_PREDICATES.open})::text AS open,
        count(*) FILTER (WHERE ${STATUS_PREDICATES.upcoming})::text AS upcoming,
        count(*) FILTER (WHERE ${STATUS_PREDICATES.closed})::text AS closed
      FROM procurements
      WHERE ${where}
    `,
    values,
  };
}

export function buildStateFacetQuery(filters: ProcurementFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "states");
  const where = [...conditions, "state IS NOT NULL"].join(" AND ");
  return {
    text: `
      SELECT state AS value, state AS label, count(*)::text AS count
      FROM procurements
      WHERE ${where}
      GROUP BY state
      ORDER BY count(*) DESC
    `,
    values,
  };
}

export type ProcurementRow = {
  source_id: string;
  description: string | null;
  agency_name: string | null;
  city_name: string | null;
  state: string | null;
  modality_name: string | null;
  estimated_value: string | null;
  proposal_opens_at: Date | null;
  proposal_closes_at: Date | null;
  enriched: boolean;
  /** Which branch surfaced the row — null on the keyword-only path (no free
   * text, or the embedder was unavailable). */
  match_kind: "keyword" | "semantic" | "both" | null;
  /** Cosine similarity of the semantic branch (null for keyword-only hits).
   * pg hands numeric expressions back as strings unless a parser says
   * otherwise. */
  similarity: string | number | null;
};

export type ModalityOption = { id: number; name: string };

/** `qEmbedding` is the pgvector text literal for `filters.q` (see
 * `embedQuery` in lib/agent/embed.ts). Pass null/undefined — or omit it — to
 * get the keyword-only behaviour. Facet counts stay keyword-only either way:
 * they are computed over the structured filters, not the fused candidate set
 * (documented limitation). */
export async function fetchProcurements(
  filters: ProcurementFilters,
  limit: number,
  offset: number,
  companyCnaes?: string[],
  qEmbedding?: string | null,
) {
  const listQuery = buildListQuery(
    filters,
    limit,
    offset,
    companyCnaes,
    qEmbedding,
  );
  const countQuery = buildCountQuery(filters, companyCnaes, qEmbedding);

  const [rowsResult, countResult] = await Promise.all([
    pool.query<ProcurementRow>(listQuery.text, listQuery.values),
    pool.query<{ count: string }>(countQuery.text, countQuery.values),
  ]);

  return {
    rows: rowsResult.rows,
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function fetchPortalOptions(): Promise<string[]> {
  const query = buildPortalOptionsQuery();
  const result = await pool.query<{ portal: string }>(query.text, query.values);
  return result.rows.map((row) => row.portal);
}

export async function fetchModalityOptions(): Promise<ModalityOption[]> {
  const query = buildModalityOptionsQuery();
  const result = await pool.query<{ modality_id: number; modality_name: string }>(
    query.text,
    query.values,
  );
  return result.rows.map((row) => ({
    id: row.modality_id,
    name: row.modality_name,
  }));
}

/** Per-option counts for the 5 multi-select filters, each computed against
 * all other active filters (own dimension's selection excluded) — standard
 * faceting. */
export async function fetchFacetCounts(
  filters: ProcurementFilters,
): Promise<FacetCounts> {
  const modalityQuery = buildModalityFacetQuery(filters);
  const categoryQuery = buildCategoryFacetQuery(filters);
  const portalQuery = buildPortalFacetQuery(filters);
  const statusQuery = buildStatusFacetQuery(filters);
  const stateQuery = buildStateFacetQuery(filters);

  const [
    modalityResult,
    categoryResult,
    portalResult,
    statusResult,
    stateResult,
  ] = await Promise.all([
    pool.query<{ value: number; label: string; count: string }>(
      modalityQuery.text,
      modalityQuery.values,
    ),
    pool.query<{ value: string; label: string; count: string }>(
      categoryQuery.text,
      categoryQuery.values,
    ),
    pool.query<{ value: string; label: string; count: string }>(
      portalQuery.text,
      portalQuery.values,
    ),
    pool.query<{ open: string; upcoming: string; closed: string }>(
      statusQuery.text,
      statusQuery.values,
    ),
    pool.query<{ value: string; label: string; count: string }>(
      stateQuery.text,
      stateQuery.values,
    ),
  ]);

  const statusRow = statusResult.rows[0];

  return {
    modality: modalityResult.rows.map((row) => ({
      value: row.value,
      label: row.label,
      count: Number(row.count),
    })),
    category: categoryResult.rows.map((row) => ({
      value: row.value,
      label: row.label,
      count: Number(row.count),
    })),
    portal: portalResult.rows.map((row) => ({
      value: row.value,
      label: row.label,
      count: Number(row.count),
    })),
    status: (["open", "upcoming", "closed"] as const).map((status) => ({
      value: status,
      label: STATUS_LABELS[status],
      count: Number(statusRow?.[status] ?? 0),
    })),
    state: stateResult.rows.map((row) => ({
      value: row.value,
      label: row.label,
      count: Number(row.count),
    })),
  };
}
