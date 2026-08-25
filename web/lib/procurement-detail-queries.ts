// SQL for /procurement/[sourceId]: one procurement plus its items and
// documents. The public identifier in the URL is `source_id`
// (numeroControlePNCP); child tables key on the surrogate `procurements.id`
// (docs/adr/001-lixto-data-model.md, D3), so the detail row carries it.
//
// Every value from the outside world (the route param) is bound as a
// parameterized placeholder — never string-interpolated into SQL text.

import { pool } from "./db";

export type ProcurementDetail = {
  id: number;
  source_id: string;
  year: number | null;
  sequence: number | null;
  process_number: string | null;
  agency_tax_id: string | null;
  agency_name: string | null;
  unit_name: string | null;
  state: string | null;
  city_name: string | null;
  modality_name: string | null;
  dispute_mode_name: string | null;
  status_name: string | null;
  legal_basis_name: string | null;
  description: string | null;
  additional_info: string | null;
  is_price_registry: boolean | null;
  estimated_value: string | null;
  awarded_value: string | null;
  published_at: Date | null;
  proposal_opens_at: Date | null;
  proposal_closes_at: Date | null;
  origin_url: string | null;
};

export type ItemRow = {
  item_number: number;
  description: string | null;
  kind: string | null;
  quantity: string | null;
  unit: string | null;
  estimated_unit_price: string | null;
  estimated_total: string | null;
  status_name: string | null;
  benefit_type_name: string | null;
};

export type DocumentRow = {
  sequence: number;
  title: string | null;
  type_id: number | null;
  type_name: string | null;
  url: string | null;
};

/** Fetches one procurement by its public `source_id`, or null when it doesn't
 * exist. `id` comes back so items/documents/prices can key on it. */
export async function fetchProcurementDetail(
  sourceId: string,
): Promise<ProcurementDetail | null> {
  const result = await pool.query<ProcurementDetail & { id: string }>(
    `SELECT
       p.id, p.source_id, p.year, p.sequence, p.process_number,
       p.agency_tax_id, a.name AS agency_name, u.name AS unit_name,
       p.state, p.city_name,
       p.modality_name, p.dispute_mode_name, p.status_name, p.legal_basis_name,
       p.description, p.additional_info, p.is_price_registry,
       p.estimated_value, p.awarded_value,
       p.published_at, p.proposal_opens_at, p.proposal_closes_at,
       p.origin_url
     FROM procurements p
     JOIN agencies a ON a.tax_id = p.agency_tax_id
     LEFT JOIN agency_units u
       ON u.agency_tax_id = p.agency_tax_id AND u.code = p.unit_code
     WHERE p.source_id = $1`,
    [sourceId],
  );
  const row = result.rows[0];
  return row ? { ...row, id: Number(row.id) } : null;
}

/** All items of a procurement, ordered by item_number. */
export async function fetchItems(procurementId: number): Promise<ItemRow[]> {
  const result = await pool.query<ItemRow>(
    `SELECT
       item_number, description, kind, quantity, unit,
       estimated_unit_price, estimated_total,
       status_name, benefit_type_name
     FROM procurement_items
     WHERE procurement_id = $1
     ORDER BY item_number ASC`,
    [procurementId],
  );
  return result.rows;
}

/** Active documents of a procurement, ordered by sequence. Grouping into
 * Edital (type_id = 2) vs Anexos is a presentation concern handled by the
 * DocumentsList component. */
export async function fetchDocuments(
  procurementId: number,
): Promise<DocumentRow[]> {
  const result = await pool.query<DocumentRow>(
    `SELECT sequence, title, type_id, type_name, url
     FROM procurement_documents
     WHERE procurement_id = $1 AND is_active IS NOT false
     ORDER BY sequence ASC`,
    [procurementId],
  );
  return result.rows;
}
