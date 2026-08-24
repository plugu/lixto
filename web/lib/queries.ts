// SQL builder for the list page's search + filters (ticket 08).
//
// Every value from the outside world (q, portal, modalidadeId) is bound as a
// parameterized placeholder — never string-interpolated into SQL text.
//
// Status filtering mirrors the v_abertas / v_futuras / v_encerradas view
// definitions in migrations/001_schema.sql (same semantics as lib/status.ts's
// computeStatus, expressed as SQL predicates).

import { pool } from "./db";
import { PORTAIS_ATIVOS } from "./portais";
import { STATUS_LABELS, type StatusLicitacao } from "./status";

export type CategoriaLicitacao = "produto" | "servico" | "mista";

export type FitFilterValue = "fit" | "borderline" | "no_fit" | "sem_analise";

export type LicitacaoFilters = {
  q?: string;
  portais?: string[];
  modalidadeIds?: number[];
  statuses?: StatusLicitacao[];
  categoria?: CategoriaLicitacao;
  setores?: string[];
  ufs?: string[];
  valorMin?: number;
  valorMax?: number;
  /** Agent verdict filter (ticket 15): `fit`/`borderline`/`no_fit` match
   * analise.verdict; `sem_analise` means no analise row (verdict IS NULL). */
  fit?: FitFilterValue[];
  /** "Compatível com minha empresa" toggle (ticket 52, searchParam
   * `compat=1`). Only meaningful when the caller also supplies the logged-in
   * empresa's CNAE codes to buildWhereClause/buildListQuery/buildCountQuery —
   * with no codes (logged out, or empresa has none), the filter is ignored. */
  compat?: boolean;
};

/** The five filter dimensions with per-option facet counts (ticket 11). */
type MultiFilterKey = "modalidadeIds" | "setores" | "portais" | "statuses" | "ufs";

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
  modalidade: FacetOption[];
  setor: FacetOption[];
  portal: FacetOption[];
  status: FacetOption[];
  uf: FacetOption[];
};

// Produto/serviço derives from the itens' PNCP materialOuServico flag (M/S):
// all-M = produto, all-S = serviço, both = mista. Licitações whose itens are
// not yet synced match no category (they have no item rows).
const HAS_M =
  "EXISTS (SELECT 1 FROM item i WHERE i.numero_controle_pncp = licitacao.numero_controle_pncp AND i.material_ou_servico = 'M')";
const HAS_S =
  "EXISTS (SELECT 1 FROM item i WHERE i.numero_controle_pncp = licitacao.numero_controle_pncp AND i.material_ou_servico = 'S')";

const CATEGORIA_PREDICATES: Record<CategoriaLicitacao, string> = {
  produto: `(${HAS_M} AND NOT ${HAS_S})`,
  servico: `(${HAS_S} AND NOT ${HAS_M})`,
  mista: `(${HAS_M} AND ${HAS_S})`,
};

const STATUS_PREDICATES: Record<StatusLicitacao, string> = {
  aberta:
    "data_abertura_proposta <= now() AND now() < data_encerramento_proposta",
  vai_abrir: "data_abertura_proposta > now()",
  fechada:
    "(data_encerramento_proposta < now() OR data_encerramento_proposta IS NULL)",
};

/** Parses raw (possibly array-valued, from Next's searchParams) query values
 * into typed filters. Repeated params (`?modalidade=6&modalidade=8`) arrive
 * as arrays already; a single occurrence arrives as a bare string, which we
 * normalize into a one-element array — so a UI that only ever sends a single
 * value (components/filters.tsx, pre ticket-12) keeps working unchanged.
 * Unknown/invalid values are dropped rather than throwing, so a malformed
 * URL just falls back to "no filter" for that field. */
export function parseFilters(
  raw: Record<string, string | string[] | undefined>,
): LicitacaoFilters {
  const filters: LicitacaoFilters = {};

  const q = firstValue(raw.q)?.trim();
  if (q) filters.q = q;

  const portais = allValues(raw.portal);
  if (portais.length > 0) filters.portais = portais;

  const modalidadeIds = allValues(raw.modalidade)
    .map((v) => Number.parseInt(v, 10))
    .filter((v) => Number.isInteger(v));
  if (modalidadeIds.length > 0) filters.modalidadeIds = modalidadeIds;

  const statuses = allValues(raw.status).filter(
    (v): v is StatusLicitacao =>
      v === "aberta" || v === "vai_abrir" || v === "fechada",
  );
  if (statuses.length > 0) filters.statuses = statuses;

  const categoria = firstValue(raw.categoria)?.trim();
  if (categoria === "produto" || categoria === "servico" || categoria === "mista") {
    filters.categoria = categoria;
  }

  const setores = allValues(raw.setor);
  if (setores.length > 0) filters.setores = setores;

  const ufs = allValues(raw.uf)
    .map((v) => v.toUpperCase())
    .filter((v) => /^[A-Z]{2}$/.test(v));
  if (ufs.length > 0) filters.ufs = ufs;

  const valorMin = parseValor(firstValue(raw.valorMin));
  if (valorMin !== undefined) filters.valorMin = valorMin;

  const valorMax = parseValor(firstValue(raw.valorMax));
  if (valorMax !== undefined) filters.valorMax = valorMax;

  const fit = allValues(raw.fit).filter(
    (v): v is FitFilterValue =>
      v === "fit" || v === "borderline" || v === "no_fit" || v === "sem_analise",
  );
  if (fit.length > 0) filters.fit = fit;

  if (firstValue(raw.compat) === "1") filters.compat = true;

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

function parseValor(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Builds the WHERE conditions + params shared by the list, count and facet
 * queries. `exclude`, when given, skips that one multi-select dimension's
 * own predicate — standard faceting, so a dimension's own selection never
 * narrows its own per-option counts (ticket 11). `values` starts at $1;
 * callers append further params (limit/offset) after. */
function buildFilterConditions(
  filters: LicitacaoFilters,
  exclude?: MultiFilterKey,
): { conditions: string[]; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];

  // Platform-wide top-7 portal allowlist (ticket 10): always applied, even
  // with no user filters, so the WHERE clause is never empty.
  values.push(PORTAIS_ATIVOS);
  conditions.push(`usuario_nome = ANY($${values.length})`);

  if (filters.q) {
    values.push(filters.q);
    const idx = values.length;
    conditions.push(
      // f_unaccent on both sides (migration 005): "lapis" matches "lápis".
      `(to_tsvector('portuguese', f_unaccent(coalesce(objeto_compra, ''))) @@ websearch_to_tsquery('portuguese', f_unaccent($${idx}))` +
        ` OR EXISTS (` +
        `SELECT 1 FROM item` +
        ` WHERE item.numero_controle_pncp = licitacao.numero_controle_pncp` +
        ` AND to_tsvector('portuguese', f_unaccent(coalesce(item.descricao, ''))) @@ websearch_to_tsquery('portuguese', f_unaccent($${idx}))` +
        `))`,
    );
  }

  if (exclude !== "portais" && filters.portais && filters.portais.length > 0) {
    // "Portal" filters on usuario_nome — the publishing system's name (e.g.
    // "Compras.gov.br"). link_sistema_origem's domain is NULL on ~59% of rows
    // and undercounts Comprasnet by half; usuario_nome is always present.
    // Applied alongside (intersected with) the top-7 allowlist above.
    values.push(filters.portais);
    conditions.push(`usuario_nome = ANY($${values.length})`);
  }

  if (
    exclude !== "modalidadeIds" &&
    filters.modalidadeIds &&
    filters.modalidadeIds.length > 0
  ) {
    values.push(filters.modalidadeIds);
    conditions.push(`modalidade_id = ANY($${values.length})`);
  }

  if (exclude !== "statuses" && filters.statuses && filters.statuses.length > 0) {
    // Multiple statuses OR-combine (e.g. aberta OR vai_abrir).
    const predicates = filters.statuses.map((s) => `(${STATUS_PREDICATES[s]})`);
    conditions.push(`(${predicates.join(" OR ")})`);
  }

  if (filters.categoria) {
    conditions.push(CATEGORIA_PREDICATES[filters.categoria]);
  }

  if (exclude !== "setores" && filters.setores && filters.setores.length > 0) {
    values.push(filters.setores);
    conditions.push(`setor = ANY($${values.length})`);
  }

  if (exclude !== "ufs" && filters.ufs && filters.ufs.length > 0) {
    values.push(filters.ufs);
    conditions.push(`uf = ANY($${values.length})`);
  }

  if (filters.valorMin !== undefined) {
    values.push(filters.valorMin);
    conditions.push(`valor_total_estimado >= $${values.length}`);
  }

  if (filters.valorMax !== undefined) {
    values.push(filters.valorMax);
    conditions.push(`valor_total_estimado <= $${values.length}`);
  }

  return { conditions, values };
}

/** Builds the `fit` predicate against the `analise` table (ticket 15), joined
 * in via `LEFT JOIN analise a USING (numero_controle_pncp)` by callers.
 * `sem_analise` (no analise row) and the three verdict values OR-combine when
 * both are selected. Appends to `values` and returns the predicate text, or
 * null when no fit filter is active. Used only by buildWhereClause (list +
 * count queries) — the facet-count queries (ticket 11/12) are untouched. */
function buildFitPredicate(
  filters: LicitacaoFilters,
  values: unknown[],
): string | null {
  if (!filters.fit || filters.fit.length === 0) return null;

  const verdicts = filters.fit.filter((v) => v !== "sem_analise");
  const wantsSemAnalise = filters.fit.includes("sem_analise");

  const predicates: string[] = [];
  if (verdicts.length > 0) {
    values.push(verdicts);
    predicates.push(`a.verdict = ANY($${values.length})`);
  }
  if (wantsSemAnalise) {
    predicates.push(`a.verdict IS NULL`);
  }

  return predicates.length > 0 ? `(${predicates.join(" OR ")})` : null;
}

/** Builds the `compat` ("Compatível com minha empresa", ticket 52) predicate:
 * an EXISTS against `licitacao_cnae` for any of the logged-in empresa's CNAE
 * codes. Appends to `values` and returns the predicate text, or null when
 * the filter isn't active or no codes were supplied (`compat=1` set but no
 * session/empresa, or an empresa with zero CNAEs, both no-op). Used only by
 * buildWhereClause (list + count queries), same as buildFitPredicate — the
 * facet-count queries are untouched, matching the fit filter's precedent. */
function buildCompatPredicate(
  filters: LicitacaoFilters,
  empresaCnaes: string[] | undefined,
  values: unknown[],
): string | null {
  if (!filters.compat) return null;
  if (!empresaCnaes || empresaCnaes.length === 0) return null;

  values.push(empresaCnaes);
  return `EXISTS (SELECT 1 FROM licitacao_cnae lc WHERE lc.numero_controle_pncp = licitacao.numero_controle_pncp AND lc.codigo = ANY($${values.length}))`;
}

/** Builds the WHERE clause + params shared by the list and count queries.
 * `values` starts at $1; callers append further params (limit/offset) after.
 * `empresaCnaes` is the logged-in empresa's CNAE codes (ticket 52), threaded
 * from the page — omit/empty when logged out or the filter is a no-op. */
export function buildWhereClause(
  filters: LicitacaoFilters,
  empresaCnaes?: string[],
): {
  where: string;
  values: unknown[];
} {
  const { conditions, values } = buildFilterConditions(filters);
  const fitPredicate = buildFitPredicate(filters, values);
  if (fitPredicate) conditions.push(fitPredicate);
  const compatPredicate = buildCompatPredicate(filters, empresaCnaes, values);
  if (compatPredicate) conditions.push(compatPredicate);
  const where = `WHERE ${conditions.join(" AND ")}`;
  return { where, values };
}

// Same ordering as ticket 07: abertas closing soonest, then futuras (vai
// abrir) opening soonest, then fechadas newest first.
export function buildListQuery(
  filters: LicitacaoFilters,
  limit: number,
  offset: number,
  empresaCnaes?: string[],
): SqlQuery {
  const { where, values } = buildWhereClause(filters, empresaCnaes);
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;

  const text = `
    WITH classified AS (
      SELECT
        numero_controle_pncp,
        objeto_compra,
        orgao_razao_social,
        municipio_nome,
        uf,
        modalidade_nome,
        valor_total_estimado,
        data_abertura_proposta,
        data_encerramento_proposta,
        a.verdict AS fit_verdict,
        a.fit_score,
        a.deep_verdict,
        a.deep_status,
        CASE
          WHEN data_abertura_proposta <= now() AND now() < data_encerramento_proposta THEN 0
          WHEN data_abertura_proposta > now() THEN 1
          ELSE 2
        END AS status_group,
        CASE
          WHEN data_abertura_proposta <= now() AND now() < data_encerramento_proposta
            THEN extract(epoch FROM data_encerramento_proposta)
          WHEN data_abertura_proposta > now()
            THEN extract(epoch FROM data_abertura_proposta)
          ELSE -extract(epoch FROM coalesce(
            data_encerramento_proposta, data_publicacao_pncp, '-infinity'::timestamptz
          ))
        END AS sort_val
      FROM licitacao
      LEFT JOIN analise a USING (numero_controle_pncp)
      ${where}
    )
    SELECT
      numero_controle_pncp, objeto_compra, orgao_razao_social, municipio_nome, uf,
      modalidade_nome, valor_total_estimado, data_abertura_proposta, data_encerramento_proposta,
      fit_verdict, fit_score, deep_verdict, deep_status
    FROM classified
    ORDER BY status_group ASC, sort_val ASC NULLS LAST
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  return { text, values: [...values, limit, offset] };
}

export function buildCountQuery(
  filters: LicitacaoFilters,
  empresaCnaes?: string[],
): SqlQuery {
  const { where, values } = buildWhereClause(filters, empresaCnaes);
  return {
    text: `SELECT count(*)::text AS count FROM licitacao LEFT JOIN analise a USING (numero_controle_pncp) ${where}`,
    values,
  };
}

export function buildPortalOptionsQuery(): SqlQuery {
  return {
    text: `SELECT DISTINCT usuario_nome AS portal FROM licitacao WHERE usuario_nome = ANY($1) ORDER BY 1`,
    values: [PORTAIS_ATIVOS],
  };
}

export function buildSetorOptionsQuery(): SqlQuery {
  return {
    text: `SELECT DISTINCT setor FROM licitacao WHERE setor IS NOT NULL ORDER BY 1`,
    values: [],
  };
}

export function buildModalidadeOptionsQuery(): SqlQuery {
  return {
    text:
      `SELECT DISTINCT modalidade_id, modalidade_nome FROM licitacao` +
      ` WHERE modalidade_id IS NOT NULL AND modalidade_nome IS NOT NULL` +
      ` ORDER BY modalidade_nome`,
    values: [],
  };
}

// Facet-count queries (ticket 11): for each of the 5 multi-select
// dimensions, a grouped count applying every active filter EXCEPT that
// dimension's own selection (standard faceting), so picking one option
// never zeroes out the others' counts.

export function buildModalidadeFacetQuery(filters: LicitacaoFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "modalidadeIds");
  const where = [
    ...conditions,
    "modalidade_id IS NOT NULL",
    "modalidade_nome IS NOT NULL",
  ].join(" AND ");
  return {
    text: `
      SELECT modalidade_id AS value, modalidade_nome AS label, count(*)::text AS count
      FROM licitacao
      WHERE ${where}
      GROUP BY modalidade_id, modalidade_nome
      ORDER BY count(*) DESC
    `,
    values,
  };
}

export function buildSetorFacetQuery(filters: LicitacaoFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "setores");
  const where = [...conditions, "setor IS NOT NULL"].join(" AND ");
  return {
    text: `
      SELECT setor AS value, setor AS label, count(*)::text AS count
      FROM licitacao
      WHERE ${where}
      GROUP BY setor
      ORDER BY count(*) DESC
    `,
    values,
  };
}

export function buildPortalFacetQuery(filters: LicitacaoFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "portais");
  const where = conditions.join(" AND ");
  return {
    text: `
      SELECT usuario_nome AS value, usuario_nome AS label, count(*)::text AS count
      FROM licitacao
      WHERE ${where}
      GROUP BY usuario_nome
      ORDER BY count(*) DESC
    `,
    values,
  };
}

export function buildStatusFacetQuery(filters: LicitacaoFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "statuses");
  const where = conditions.join(" AND ");
  return {
    text: `
      SELECT
        count(*) FILTER (WHERE ${STATUS_PREDICATES.aberta})::text AS aberta,
        count(*) FILTER (WHERE ${STATUS_PREDICATES.vai_abrir})::text AS vai_abrir,
        count(*) FILTER (WHERE ${STATUS_PREDICATES.fechada})::text AS fechada
      FROM licitacao
      WHERE ${where}
    `,
    values,
  };
}

export function buildUfFacetQuery(filters: LicitacaoFilters): SqlQuery {
  const { conditions, values } = buildFilterConditions(filters, "ufs");
  const where = [...conditions, "uf IS NOT NULL"].join(" AND ");
  return {
    text: `
      SELECT uf AS value, uf AS label, count(*)::text AS count
      FROM licitacao
      WHERE ${where}
      GROUP BY uf
      ORDER BY count(*) DESC
    `,
    values,
  };
}

export type LicitacaoRow = {
  numero_controle_pncp: string;
  objeto_compra: string | null;
  orgao_razao_social: string | null;
  municipio_nome: string | null;
  uf: string | null;
  modalidade_nome: string | null;
  valor_total_estimado: string | null;
  data_abertura_proposta: Date | null;
  data_encerramento_proposta: Date | null;
  fit_verdict: string | null;
  fit_score: number | null;
  deep_verdict: string | null;
  deep_status: string | null;
};

export type ModalidadeOption = { id: number; nome: string };

export async function fetchLicitacoes(
  filters: LicitacaoFilters,
  limit: number,
  offset: number,
  empresaCnaes?: string[],
) {
  const listQuery = buildListQuery(filters, limit, offset, empresaCnaes);
  const countQuery = buildCountQuery(filters, empresaCnaes);

  const [rowsResult, countResult] = await Promise.all([
    pool.query<LicitacaoRow>(listQuery.text, listQuery.values),
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

export async function fetchSetorOptions(): Promise<string[]> {
  const query = buildSetorOptionsQuery();
  const result = await pool.query<{ setor: string }>(query.text, query.values);
  return result.rows.map((row) => row.setor);
}

export async function fetchModalidadeOptions(): Promise<ModalidadeOption[]> {
  const query = buildModalidadeOptionsQuery();
  const result = await pool.query<{ modalidade_id: number; modalidade_nome: string }>(
    query.text,
    query.values,
  );
  return result.rows.map((row) => ({
    id: row.modalidade_id,
    nome: row.modalidade_nome,
  }));
}

/** Per-option counts for the 5 multi-select filters, each computed against
 * all other active filters (own dimension's selection excluded) — standard
 * faceting. UI rendering of these counts is ticket 12. */
export async function fetchFacetCounts(filters: LicitacaoFilters): Promise<FacetCounts> {
  const modalidadeQuery = buildModalidadeFacetQuery(filters);
  const setorQuery = buildSetorFacetQuery(filters);
  const portalQuery = buildPortalFacetQuery(filters);
  const statusQuery = buildStatusFacetQuery(filters);
  const ufQuery = buildUfFacetQuery(filters);

  const [modalidadeResult, setorResult, portalResult, statusResult, ufResult] =
    await Promise.all([
      pool.query<{ value: number; label: string; count: string }>(
        modalidadeQuery.text,
        modalidadeQuery.values,
      ),
      pool.query<{ value: string; label: string; count: string }>(
        setorQuery.text,
        setorQuery.values,
      ),
      pool.query<{ value: string; label: string; count: string }>(
        portalQuery.text,
        portalQuery.values,
      ),
      pool.query<{ aberta: string; vai_abrir: string; fechada: string }>(
        statusQuery.text,
        statusQuery.values,
      ),
      pool.query<{ value: string; label: string; count: string }>(
        ufQuery.text,
        ufQuery.values,
      ),
    ]);

  const statusRow = statusResult.rows[0];

  return {
    modalidade: modalidadeResult.rows.map((row) => ({
      value: row.value,
      label: row.label,
      count: Number(row.count),
    })),
    setor: setorResult.rows.map((row) => ({
      value: row.value,
      label: row.label,
      count: Number(row.count),
    })),
    portal: portalResult.rows.map((row) => ({
      value: row.value,
      label: row.label,
      count: Number(row.count),
    })),
    status: (["aberta", "vai_abrir", "fechada"] as const).map((status) => ({
      value: status,
      label: STATUS_LABELS[status],
      count: Number(statusRow?.[status] ?? 0),
    })),
    uf: ufResult.rows.map((row) => ({
      value: row.value,
      label: row.label,
      count: Number(row.count),
    })),
  };
}
