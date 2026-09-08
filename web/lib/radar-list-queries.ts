// SQL builder for the /radar list page (ticket 127): the session company's
// matched, still-`predicted` future opportunities, ranked by match score,
// with view (all/saved/ignored), state, period, value and min-score filters.
//
// Follows the pure-builder style of web/lib/procurement-queries.ts:
// `SqlQuery`, a `parse*` function that drops invalid values, `companyId`
// bound as $1 and never string-interpolated (docs/adr/001-lixto-data-model.md).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { pool } from "./db";
import type { Reason } from "./match-engine";
import type { Signal } from "./radar-engine";

export type RadarView = "all" | "saved" | "ignored";

export type RadarPeriod = 30 | 60 | 90 | 180 | 365;

export type RadarFilters = {
  view: RadarView;
  states: string[];
  period: RadarPeriod | null;
  minValue: number | null;
  maxValue: number | null;
  minScore: number | null;
};

export type SqlQuery = {
  text: string;
  values: unknown[];
};

const VALID_PERIODS: readonly RadarPeriod[] = [30, 60, 90, 180, 365];

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function allValues(value: string | string[] | undefined): string[] {
  const arr = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return arr.map((v) => v.trim()).filter((v) => v.length > 0);
}

function parseNumber(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parsePeriod(raw: string | undefined): RadarPeriod | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return (VALID_PERIODS as readonly number[]).includes(n)
    ? (n as RadarPeriod)
    : null;
}

function parseView(raw: string | string[] | undefined): RadarView {
  const value = firstValue(raw);
  return value === "saved" || value === "ignored" ? value : "all";
}

/** Parses raw (possibly array-valued, from Next's searchParams) query values
 * into typed radar filters. Unknown/invalid values are dropped rather than
 * throwing — a malformed URL falls back to "no filter" for that field, and
 * an unknown `view` falls back to the default `"all"`. */
export function parseRadarFilters(
  raw: Record<string, string | string[] | undefined>,
): RadarFilters {
  const states = allValues(raw.state)
    .map((v) => v.toUpperCase())
    .filter((v) => /^[A-Z]{2}$/.test(v));

  return {
    view: parseView(raw.view),
    states,
    period: parsePeriod(firstValue(raw.period)),
    minValue: parseNumber(firstValue(raw.minValue)),
    maxValue: parseNumber(firstValue(raw.maxValue)),
    minScore: parseNumber(firstValue(raw.minScore)),
  };
}

const RADAR_FROM = `FROM future_opportunities fo
      JOIN future_opportunity_matches m
        ON m.future_opportunity_id = fo.id AND m.company_id = $1
      LEFT JOIN future_opportunity_actions a
        ON a.future_opportunity_id = fo.id AND a.company_id = $1
      JOIN agencies ag ON ag.tax_id = fo.agency_tax_id
      JOIN procurement_plans p ON p.id = fo.plan_id`;

const VIEW_PREDICATES: Record<RadarView, string> = {
  all: "(a.state IS NULL OR a.state <> 'ignored')",
  saved: "a.state = 'saved'",
  ignored: "a.state = 'ignored'",
};

/** Builds the WHERE conditions + params shared by the list and count
 * queries. `values` starts with `companyId` as $1 (also reused by the two
 * company-scoped joins above); callers append further params after. */
function buildRadarConditions(
  companyId: number,
  filters: RadarFilters,
): { conditions: string[]; values: unknown[] } {
  const values: unknown[] = [companyId];
  const conditions: string[] = [`fo.status = 'predicted'`, VIEW_PREDICATES[filters.view]];

  if (filters.states.length > 0) {
    values.push(filters.states);
    conditions.push(`fo.state = ANY($${values.length})`);
  }

  if (filters.period !== null) {
    values.push(filters.period);
    // `fo.expected_date` is a DATE; a NULL date compares to NULL (never
    // true) here, so rows with no expected date drop out whenever a period
    // is active — exactly the "NULL dates only when period is null" rule.
    conditions.push(`fo.expected_date <= current_date + $${values.length}::int`);
  }

  if (filters.minValue !== null) {
    values.push(filters.minValue);
    conditions.push(`fo.estimated_value >= $${values.length}`);
  }

  if (filters.maxValue !== null) {
    values.push(filters.maxValue);
    conditions.push(`fo.estimated_value <= $${values.length}`);
  }

  if (filters.minScore !== null) {
    values.push(filters.minScore);
    conditions.push(`m.match_score >= $${values.length}`);
  }

  return { conditions, values };
}

export function buildRadarListQuery(
  companyId: number,
  filters: RadarFilters,
  limit: number,
  offset: number,
): SqlQuery {
  const { conditions, values } = buildRadarConditions(companyId, filters);
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;

  const text = `
    SELECT
      fo.id,
      fo.title,
      fo.state,
      fo.estimated_value,
      fo.expected_date,
      fo.plan_year,
      fo.opportunity_score,
      fo.signals,
      m.match_score,
      m.reasons,
      a.state AS action_state,
      ag.name AS agency_name,
      p.unit_name
    ${RADAR_FROM}
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.match_score DESC, fo.opportunity_score DESC, fo.expected_date ASC NULLS LAST, fo.id
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  return { text, values: [...values, limit, offset] };
}

export function buildRadarCountQuery(
  companyId: number,
  filters: RadarFilters,
): SqlQuery {
  const { conditions, values } = buildRadarConditions(companyId, filters);

  const text = `
    SELECT
      count(*)::text AS total,
      coalesce(sum(fo.estimated_value), 0)::text AS total_value
    ${RADAR_FROM}
    WHERE ${conditions.join(" AND ")}
  `;

  return { text, values };
}

export function buildRadarStateOptionsQuery(companyId: number): SqlQuery {
  const text = `
    SELECT DISTINCT fo.state
    FROM future_opportunities fo
    JOIN future_opportunity_matches m
      ON m.future_opportunity_id = fo.id AND m.company_id = $1
    WHERE fo.status = 'predicted' AND fo.state IS NOT NULL
    ORDER BY fo.state
  `;
  return { text, values: [companyId] };
}

export type RadarListRow = {
  id: string;
  title: string;
  state: string | null;
  estimated_value: string | null;
  expected_date: Date | string | null;
  plan_year: number;
  opportunity_score: number;
  signals: Signal[];
  match_score: number;
  reasons: Reason[];
  action_state: "saved" | "ignored" | null;
  agency_name: string;
  unit_name: string | null;
};

export type RadarSummary = {
  total: number;
  total_value: number;
};

export async function fetchRadarList(
  companyId: number,
  filters: RadarFilters,
  limit: number,
  offset: number,
): Promise<RadarListRow[]> {
  const query = buildRadarListQuery(companyId, filters, limit, offset);
  const { rows } = await pool.query<RadarListRow>(query.text, query.values);
  return rows;
}

export async function fetchRadarSummary(
  companyId: number,
  filters: RadarFilters,
): Promise<RadarSummary> {
  const query = buildRadarCountQuery(companyId, filters);
  const { rows } = await pool.query<{ total: string; total_value: string }>(
    query.text,
    query.values,
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    total_value: Number(rows[0]?.total_value ?? 0),
  };
}

export async function fetchRadarStateOptions(companyId: number): Promise<string[]> {
  const query = buildRadarStateOptionsQuery(companyId);
  const { rows } = await pool.query<{ state: string }>(query.text, query.values);
  return rows.map((row) => row.state);
}
