// Read side of the global enrichment (`procurement_enrichments` + the facet
// tables `procurement_categories` / `procurement_requirements`). One canonical
// row per procurement, shared by every company — this module never takes a
// company id because enrichment is not per-tenant.
//
// Server-only, shared db.ts pool, the procurement id bound as $1 and never
// interpolated into SQL text. The heavy `data` blob is deliberately not
// selected: consumers only need the derived columns.

import { pool } from "./db";

export type RequirementKind =
  | "legal_qualification"
  | "tax_compliance"
  | "technical_qualification"
  | "economic_qualification"
  | "document"
  | "certification"
  | "sample"
  | "site_visit"
  | "other";

/** pt-BR labels for the English enums stored in the schema (UI copy stays
 * Portuguese — ADR 001, D7). */
export const REQUIREMENT_KIND_LABELS: Record<RequirementKind, string> = {
  legal_qualification: "Habilitação jurídica",
  tax_compliance: "Regularidade fiscal",
  technical_qualification: "Qualificação técnica",
  economic_qualification: "Qualificação econômico-financeira",
  document: "Documento",
  certification: "Certificação",
  sample: "Amostra",
  site_visit: "Visita técnica",
  other: "Outros",
};

export const COMPLEXITY_LABELS: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

export type EnrichmentRequirement = {
  kind: RequirementKind;
  description: string;
};

export type EnrichmentRow = {
  procurement_id: number;
  input_kind: string;
  summary: string | null;
  categories: string[];
  concepts: string[];
  keywords: string[];
  requirements: EnrichmentRequirement[];
  risks: string[];
  complexity: string | null;
  requires_certification: boolean | null;
  requires_technical_certificate: boolean | null;
  me_epp_exclusive: boolean | null;
  me_epp_preference: boolean | null;
  delivery_location: string | null;
  delivery_deadline_days: number | null;
  confidence: number | null;
  model: string | null;
  enriched_at: Date;
};

/** Fetches the canonical enrichment for one procurement, or null when it
 * hasn't been enriched yet (no row) or the last attempt failed
 * (`status = 'error'` — such a row carries no usable fields, so callers treat
 * it as absent). */
export async function fetchEnrichment(
  procurementId: number,
): Promise<EnrichmentRow | null> {
  const result = await pool.query<EnrichmentRow & { procurement_id: string }>(
    `SELECT
       e.procurement_id, e.input_kind, e.summary,
       e.concepts, e.keywords, e.risks, e.complexity,
       e.requires_certification, e.requires_technical_certificate,
       e.me_epp_exclusive, e.me_epp_preference,
       e.delivery_location, e.delivery_deadline_days,
       e.confidence, e.model, e.enriched_at,
       coalesce(
         (SELECT array_agg(c.category ORDER BY c.category)
            FROM procurement_categories c
           WHERE c.procurement_id = e.procurement_id),
         '{}'
       ) AS categories,
       coalesce(
         (SELECT json_agg(json_build_object('kind', r.kind, 'description', r.description)
                          ORDER BY r.sequence)
            FROM procurement_requirements r
           WHERE r.procurement_id = e.procurement_id),
         '[]'::json
       ) AS requirements
     FROM procurement_enrichments e
     WHERE e.procurement_id = $1 AND e.status = 'done'`,
    [procurementId],
  );
  const row = result.rows[0];
  return row ? { ...row, procurement_id: Number(row.procurement_id) } : null;
}
