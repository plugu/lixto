// SQL builder for the list page's search + filters (ticket 08).
//
// Every value from the outside world (q, portal, modalidadeId) is bound as a
// parameterized placeholder — never string-interpolated into SQL text.
//
// Status filtering mirrors the v_abertas / v_futuras / v_encerradas view
// definitions in migrations/001_schema.sql (same semantics as lib/status.ts's
// computeStatus, expressed as SQL predicates).

import { pool } from "./db";
import type { StatusLicitacao } from "./status";

export type LicitacaoFilters = {
  q?: string;
  portal?: string;
  modalidadeId?: number;
  status?: StatusLicitacao;
};

export type SqlQuery = {
  text: string;
  values: unknown[];
};

const STATUS_PREDICATES: Record<StatusLicitacao, string> = {
  aberta:
    "data_abertura_proposta <= now() AND now() < data_encerramento_proposta",
  vai_abrir: "data_abertura_proposta > now()",
  fechada:
    "(data_encerramento_proposta < now() OR data_encerramento_proposta IS NULL)",
};

/** Parses raw (possibly array-valued, from Next's searchParams) query values
 * into typed filters. Unknown/invalid values are dropped rather than throwing,
 * so a malformed URL just falls back to "no filter" for that field. */
export function parseFilters(
  raw: Record<string, string | string[] | undefined>,
): LicitacaoFilters {
  const filters: LicitacaoFilters = {};

  const q = firstValue(raw.q)?.trim();
  if (q) filters.q = q;

  const portal = firstValue(raw.portal)?.trim();
  if (portal) filters.portal = portal;

  const modalidadeRaw = firstValue(raw.modalidade)?.trim();
  if (modalidadeRaw) {
    const modalidadeId = Number.parseInt(modalidadeRaw, 10);
    if (Number.isInteger(modalidadeId)) filters.modalidadeId = modalidadeId;
  }

  const status = firstValue(raw.status)?.trim();
  if (status === "aberta" || status === "vai_abrir" || status === "fechada") {
    filters.status = status;
  }

  return filters;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Builds the WHERE clause + params shared by the list and count queries.
 * `values` starts at $1; callers append further params (limit/offset) after. */
export function buildWhereClause(filters: LicitacaoFilters): {
  where: string;
  values: unknown[];
} {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.q) {
    values.push(filters.q);
    const idx = values.length;
    conditions.push(
      `(to_tsvector('portuguese', objeto_compra) @@ websearch_to_tsquery('portuguese', $${idx})` +
        ` OR EXISTS (` +
        `SELECT 1 FROM item` +
        ` WHERE item.numero_controle_pncp = licitacao.numero_controle_pncp` +
        ` AND to_tsvector('portuguese', coalesce(item.descricao, '')) @@ websearch_to_tsquery('portuguese', $${idx})` +
        `))`,
    );
  }

  if (filters.portal) {
    values.push(filters.portal);
    // "Portal" filters on usuario_nome — the publishing system's name (e.g.
    // "Compras.gov.br"). link_sistema_origem's domain is NULL on ~59% of rows
    // and undercounts Comprasnet by half; usuario_nome is always present.
    conditions.push(`usuario_nome = $${values.length}`);
  }

  if (filters.modalidadeId !== undefined) {
    values.push(filters.modalidadeId);
    conditions.push(`modalidade_id = $${values.length}`);
  }

  if (filters.status) {
    conditions.push(`(${STATUS_PREDICATES[filters.status]})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, values };
}

// Same ordering as ticket 07: abertas closing soonest, then futuras (vai
// abrir) opening soonest, then fechadas newest first.
export function buildListQuery(
  filters: LicitacaoFilters,
  limit: number,
  offset: number,
): SqlQuery {
  const { where, values } = buildWhereClause(filters);
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
      ${where}
    )
    SELECT
      numero_controle_pncp, objeto_compra, orgao_razao_social, municipio_nome, uf,
      modalidade_nome, valor_total_estimado, data_abertura_proposta, data_encerramento_proposta
    FROM classified
    ORDER BY status_group ASC, sort_val ASC NULLS LAST
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  return { text, values: [...values, limit, offset] };
}

export function buildCountQuery(filters: LicitacaoFilters): SqlQuery {
  const { where, values } = buildWhereClause(filters);
  return {
    text: `SELECT count(*)::text AS count FROM licitacao ${where}`,
    values,
  };
}

export function buildPortalOptionsQuery(): SqlQuery {
  return {
    text: `SELECT DISTINCT usuario_nome AS portal FROM licitacao WHERE usuario_nome IS NOT NULL ORDER BY 1`,
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
};

export type ModalidadeOption = { id: number; nome: string };

export async function fetchLicitacoes(
  filters: LicitacaoFilters,
  limit: number,
  offset: number,
) {
  const listQuery = buildListQuery(filters, limit, offset);
  const countQuery = buildCountQuery(filters);

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
