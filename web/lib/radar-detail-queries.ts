// SQL for /radar/[id] (ticket 128): one future opportunity plus its
// evidence, and the Salvar/Ignorar action row. Follows the pure-builder style
// of web/lib/radar-list-queries.ts / opportunity-queries.ts: `SqlQuery`,
// `companyId` bound as $1 and never string-interpolated
// (docs/adr/001-lixto-data-model.md).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { pool } from "./db";
import type { Reason } from "./match-engine";
import type { Signal } from "./radar-engine";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

/** One future opportunity, its evidence and this company's action, as
 * `fetchRadarDetail` returns it. `null` fields on the `procurement_plan_items`
 * side mean the item is no longer in the live PCA (the plan was resynced and
 * dropped it) — the page shows "Item não está mais no PCA atual" instead. */
export type RadarDetail = {
  id: number;
  title: string;
  state: string | null;
  city_name: string | null;
  estimated_value: string | null;
  expected_date: Date | string | null;
  plan_year: number;
  opportunity_score: number;
  signals: Signal[];
  match_score: number;
  reasons: Reason[];
  action_state: "saved" | "ignored" | null;
  agency_name: string;
  agency_tax_id: string;
  unit_name: string | null;
  unit_code: string | null;
  source_id: string;
  year: number;
  published_at: Date | string | null;
  source_global_updated_at: Date | string | null;
  pdm_description: string | null;
  catalog_classification_name: string | null;
  superior_classification_name: string | null;
  estimated_quantity: string | null;
  unit_value: string | null;
  supply_unit: string | null;
  requesting_unit: string | null;
  contracting_group_name: string | null;
  source_updated_at: Date | string | null;
  /** Whether `procurement_plan_items` still has this item today (vs. the
   * `future_opportunities` snapshot, which survives a resync — see the
   * migration comment). False means the opportunity may be expiring. */
  item_live: boolean;
};

type RadarDetailRow = Omit<RadarDetail, "id" | "plan_year" | "opportunity_score" | "match_score" | "year"> & {
  id: string;
  plan_year: number;
  opportunity_score: number;
  match_score: number;
  year: number;
};

/** Builds the detail statement: `companyId` gates both the match join (a
 * company with no match row for this opportunity gets zero rows, hence
 * `fetchRadarDetail` returning null — same 404 rule as the tenant-isolated
 * queries elsewhere) and the action join (this company's Salvar/Ignorar
 * choice, if any). The live `procurement_plan_items` join is LEFT so an item
 * dropped by a plan resync still resolves the opportunity, just without those
 * columns. */
export function buildFetchRadarDetail(companyId: number, id: number): SqlQuery {
  const text = `
    SELECT
      fo.id,
      fo.title,
      fo.state,
      u.city_name,
      fo.estimated_value,
      fo.expected_date,
      fo.plan_year,
      fo.opportunity_score,
      fo.signals,
      m.match_score,
      m.reasons,
      a.state AS action_state,
      ag.name AS agency_name,
      ag.tax_id AS agency_tax_id,
      p.unit_name,
      p.unit_code,
      p.source_id,
      p.year,
      p.published_at,
      p.source_global_updated_at,
      i.pdm_description,
      i.catalog_classification_name,
      i.superior_classification_name,
      i.estimated_quantity,
      i.unit_value,
      i.supply_unit,
      i.requesting_unit,
      i.contracting_group_name,
      i.source_updated_at,
      (i.plan_id IS NOT NULL) AS item_live
    FROM future_opportunities fo
    JOIN future_opportunity_matches m
      ON m.future_opportunity_id = fo.id AND m.company_id = $1
    LEFT JOIN future_opportunity_actions a
      ON a.future_opportunity_id = fo.id AND a.company_id = $1
    JOIN agencies ag ON ag.tax_id = fo.agency_tax_id
    JOIN procurement_plans p ON p.id = fo.plan_id
    LEFT JOIN procurement_plan_items i
      ON (i.plan_id, i.item_number) = (fo.plan_id, fo.item_number)
    LEFT JOIN agency_units u
      ON u.agency_tax_id = p.agency_tax_id AND u.code = p.unit_code
    WHERE fo.id = $2
  `;
  return { text, values: [companyId, id] };
}

/** Fetches one opportunity's detail, scoped to the session company. Returns
 * null both when the id doesn't exist and when it belongs to another
 * company (no `future_opportunity_matches` row) — both render the same 404. */
export async function fetchRadarDetail(
  companyId: number,
  id: number,
): Promise<RadarDetail | null> {
  const { text, values } = buildFetchRadarDetail(companyId, id);
  const { rows } = await pool.query<RadarDetailRow>(text, values);
  const row = rows[0];
  return row ? { ...row, id: Number(row.id) } : null;
}

/**
 * Upserts this company's Salvar/Ignorar choice. The INSERT ... SELECT
 * verifies ownership in the same statement (idiom: opportunity-queries.ts,
 * `insertFeedback`): an opportunity of another company's match selects zero
 * rows and nothing is written.
 */
export function buildSetRadarAction(
  companyId: number,
  id: number,
  userId: number,
  state: "saved" | "ignored",
): SqlQuery {
  const text = `
    INSERT INTO future_opportunity_actions (company_id, future_opportunity_id, state, user_id)
         SELECT $1, fo.id, $3, $4
           FROM future_opportunities fo
           JOIN future_opportunity_matches m
             ON m.future_opportunity_id = fo.id AND m.company_id = $1
          WHERE fo.id = $2
    ON CONFLICT (company_id, future_opportunity_id) DO UPDATE
       SET state = EXCLUDED.state, user_id = EXCLUDED.user_id, updated_at = now()
  `;
  return { text, values: [companyId, id, state, userId] };
}

/** Deletes this company's Salvar/Ignorar choice ("Desfazer"). Scoped to
 * `company_id`, so it can never touch another company's row. */
export function buildClearRadarAction(companyId: number, id: number): SqlQuery {
  const text = `
    DELETE FROM future_opportunity_actions
     WHERE company_id = $1 AND future_opportunity_id = $2
  `;
  return { text, values: [companyId, id] };
}

export async function setRadarAction(
  companyId: number,
  id: number,
  userId: number,
  state: "saved" | "ignored",
): Promise<void> {
  const { text, values } = buildSetRadarAction(companyId, id, userId, state);
  await pool.query(text, values);
}

export async function clearRadarAction(companyId: number, id: number): Promise<void> {
  const { text, values } = buildClearRadarAction(companyId, id);
  await pool.query(text, values);
}

/** Trailing PCA sequence out of a plan's `source_id`. Real example from the
 * dev DB: "10695891000100-0-000001/2026" — 14-digit agency CNPJ, a
 * single-digit PCA marker (always "0", unlike "-1-" on procurement source
 * ids), the zero-padded sequence, and the plan year. */
const PNCP_PLAN_SOURCE_ID_RE = /^\d{14}-\d-(\d+)\/\d{4}$/;

/** Builds the public PNCP URL for a plan. Falls back to the bare PCA app URL
 * when `sourceId` doesn't match the expected shape — the caller shows the raw
 * `source_id` alongside the link in that case. */
export function pncpPlanUrl(
  agencyTaxId: string,
  year: number,
  sourceId: string,
): string {
  const match = PNCP_PLAN_SOURCE_ID_RE.exec(sourceId);
  if (!match) return "https://pncp.gov.br/app/pca";
  const seq = Number.parseInt(match[1], 10);
  return `https://pncp.gov.br/app/pca/${agencyTaxId}/${year}/${seq}`;
}
