// Read side of the ingest classification (`procurement_classifications` +
// `procurement_cnaes`). Global per procurement, never per company. Server-only,
// shared db.ts pool, ids bound as parameters.

import { pool } from "./db";

export type ClassificationNature = "bens" | "servicos" | "obras";

export const NATURE_LABELS: Record<ClassificationNature, string> = {
  bens: "Bens",
  servicos: "Serviços",
  obras: "Obras",
};

export type ClassificationCnae = {
  code: string;
  description: string | null;
  confidence: number | null;
  origin: "enrichment" | "ingest";
};

export type ClassificationRow = {
  segment: string | null;
  segment_label: string | null;
  segment_confidence: number | null;
  nature: ClassificationNature | null;
  keywords: string[];
  classified_at: Date | null;
  cnaes: ClassificationCnae[];
};

type ClassificationDbRow = Omit<ClassificationRow, "cnaes">;

type CnaeDbRow = {
  code: string;
  description: string | null;
  confidence: number | null;
  origin: "enrichment" | "ingest";
};

export async function fetchClassification(
  procurementId: number,
): Promise<ClassificationRow | null> {
  const result = await pool.query<ClassificationDbRow>(
    `SELECT pcl.segment,
            s.label AS segment_label,
            pcl.segment_confidence,
            pcl.nature,
            COALESCE(pcl.keywords, '{}') AS keywords,
            pcl.classified_at
     FROM procurement_classifications pcl
     LEFT JOIN classification_segments s ON s.code = pcl.segment
     WHERE pcl.procurement_id = $1 AND pcl.status = 'done'`,
    [procurementId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const cnaes = await pool.query<CnaeDbRow>(
    `SELECT pc.cnae_code AS code,
            c.description,
            pc.confidence,
            pc.origin
     FROM procurement_cnaes pc
     LEFT JOIN cnae_codes c ON c.code = pc.cnae_code
     WHERE pc.procurement_id = $1
     ORDER BY (pc.origin = 'enrichment') DESC, pc.confidence DESC NULLS LAST`,
    [procurementId],
  );

  return { ...row, cnaes: cnaes.rows };
}
