// Aggregate queries for the dashboard (Visão geral). Read-only, no params
// from user input except none at all — every query here is static SQL.
import { pool } from "./db";

export type StatusCounts = {
  total: number;
  abertas: number;
  vaiAbrir: number;
  fechadas: number;
  novas24h: number;
};

export type CategoryCount = { label: string; count: number };
export type DailyCount = { day: string; count: number };

const ABERTA = "data_abertura_proposta <= now() AND now() < data_encerramento_proposta";
const VAI_ABRIR = "data_abertura_proposta > now()";

export async function fetchStatusCounts(): Promise<StatusCounts> {
  const { rows } = await pool.query<{
    total: string;
    abertas: string;
    vai_abrir: string;
    novas_24h: string;
  }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE ${ABERTA})::text AS abertas,
       count(*) FILTER (WHERE ${VAI_ABRIR})::text AS vai_abrir,
       count(*) FILTER (WHERE data_publicacao_pncp >= now() - interval '24 hours')::text AS novas_24h
     FROM licitacao`,
  );
  const row = rows[0];
  const total = Number(row?.total ?? 0);
  const abertas = Number(row?.abertas ?? 0);
  const vaiAbrir = Number(row?.vai_abrir ?? 0);
  return {
    total,
    abertas,
    vaiAbrir,
    fechadas: total - abertas - vaiAbrir,
    novas24h: Number(row?.novas_24h ?? 0),
  };
}

/** Top N categories by count with the tail folded into "Outras". */
async function fetchTopCounts(
  column: "modalidade_nome" | "usuario_nome",
  top: number,
  otherLabel: string,
): Promise<CategoryCount[]> {
  const { rows } = await pool.query<{ label: string | null; count: string }>(
    `SELECT ${column} AS label, count(*)::text AS count
     FROM licitacao
     WHERE ${column} IS NOT NULL
     GROUP BY 1 ORDER BY count(*) DESC`,
  );
  const all = rows.map((r) => ({ label: r.label ?? "—", count: Number(r.count) }));
  const head = all.slice(0, top);
  const tail = all.slice(top);
  if (tail.length > 0) {
    head.push({
      label: `${otherLabel} (${tail.length})`,
      count: tail.reduce((sum, r) => sum + r.count, 0),
    });
  }
  return head;
}

export function fetchPorModalidade(): Promise<CategoryCount[]> {
  return fetchTopCounts("modalidade_nome", 8, "Outras");
}

export function fetchPorPortal(): Promise<CategoryCount[]> {
  return fetchTopCounts("usuario_nome", 8, "Outros");
}

/** Publications per day, last 30 days, gaps filled with zero. */
export async function fetchPorDia(): Promise<DailyCount[]> {
  const { rows } = await pool.query<{ day: string; count: string }>(
    `SELECT d.day::date::text AS day, coalesce(count(l.numero_controle_pncp), 0)::text AS count
     FROM generate_series(
       date_trunc('day', now()) - interval '29 days',
       date_trunc('day', now()),
       interval '1 day'
     ) AS d(day)
     LEFT JOIN licitacao l
       ON l.data_publicacao_pncp >= d.day AND l.data_publicacao_pncp < d.day + interval '1 day'
     GROUP BY d.day ORDER BY d.day`,
  );
  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}
