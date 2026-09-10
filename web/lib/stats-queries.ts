// Aggregate queries for the dashboard (Visão geral). Read-only; the only
// bound param across these queries is the top-7 portal allowlist.
import { pool } from "./db";
import { ACTIVE_PORTALS } from "./portals";
import { CHART_SCOPE_DEFAULT, CHART_SCOPES, type ChartScopeValue } from "./url-state";

export type StatusCounts = {
  total: number;
  open: number;
  upcoming: number;
  closed: number;
  new24h: number;
};

export type CategoryCount = { label: string; count: number };
export type DailyCount = { day: string; count: number };

const OPEN = "proposal_opens_at <= now() AND now() < proposal_closes_at";
const UPCOMING = "proposal_opens_at > now()";

export async function fetchStatusCounts(): Promise<StatusCounts> {
  const { rows } = await pool.query<{
    total: string;
    open: string;
    upcoming: string;
    new_24h: string;
  }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE ${OPEN})::text AS open,
       count(*) FILTER (WHERE ${UPCOMING})::text AS upcoming,
       count(*) FILTER (WHERE published_at >= now() - interval '24 hours')::text AS new_24h
     FROM procurements
     WHERE origin_system = ANY($1)`,
    [ACTIVE_PORTALS],
  );
  const row = rows[0];
  const total = Number(row?.total ?? 0);
  const open = Number(row?.open ?? 0);
  const upcoming = Number(row?.upcoming ?? 0);
  return {
    total,
    open,
    upcoming,
    closed: total - open - upcoming,
    new24h: Number(row?.new_24h ?? 0),
  };
}

/** Scope for the breakdown charts: actionable slices or the whole base. */
export type ChartScope = ChartScopeValue;

const SCOPE_PREDICATES: Record<ChartScope, string> = {
  open: ` AND ${OPEN}`,
  upcoming: ` AND ${UPCOMING}`,
  all: "",
};

export function parseChartScope(raw: string | string[] | undefined): ChartScope {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (CHART_SCOPES as readonly string[]).includes(value ?? "")
    ? (value as ChartScope)
    : CHART_SCOPE_DEFAULT;
}

/** Top N categories by count with the tail folded into "Outras". */
async function fetchTopCounts(
  column: "modality_name" | "origin_system",
  top: number,
  otherLabel: string,
  scope: ChartScope,
): Promise<CategoryCount[]> {
  const { rows } = await pool.query<{ label: string | null; count: string }>(
    `SELECT ${column} AS label, count(*)::text AS count
     FROM procurements
     WHERE origin_system = ANY($1) AND ${column} IS NOT NULL${SCOPE_PREDICATES[scope]}
     GROUP BY 1 ORDER BY count(*) DESC`,
    [ACTIVE_PORTALS],
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

export function fetchByModality(scope: ChartScope): Promise<CategoryCount[]> {
  return fetchTopCounts("modality_name", 8, "Outras", scope);
}

export function fetchByPortal(scope: ChartScope): Promise<CategoryCount[]> {
  // Post-allowlist there are at most 7 distinct portals, so the tail fold
  // never triggers — kept as a plain top-N call for consistency.
  return fetchTopCounts("origin_system", 7, "Outros", scope);
}

/** Publications per day, last 30 days, gaps filled with zero. */
export async function fetchByDay(): Promise<DailyCount[]> {
  const { rows } = await pool.query<{ day: string; count: string }>(
    `SELECT d.day::date::text AS day, coalesce(count(p.id), 0)::text AS count
     FROM generate_series(
       date_trunc('day', now()) - interval '29 days',
       date_trunc('day', now()),
       interval '1 day'
     ) AS d(day)
     LEFT JOIN procurements p
       ON p.published_at >= d.day AND p.published_at < d.day + interval '1 day'
       AND p.origin_system = ANY($1)
     GROUP BY d.day ORDER BY d.day`,
    [ACTIVE_PORTALS],
  );
  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}
