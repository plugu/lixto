// Read side of the global enrichment (migrations/010_enriquecimento.sql,
// cycle 16). One canonical row per licitação, shared by every empresa — this
// module never takes an empresa_id because enrichment is not per-tenant.
//
// Mirrors detail-queries.ts: server-only, shared db.ts pool, the route param
// bound as $1 and never interpolated into SQL text. `requisitos` and `entrega`
// are JSONB columns — node-pg parses them into plain JS values automatically.

import { pool } from "./db";

export type EnriquecimentoRequisito = {
  tipo: string;
  descricao: string;
};

export type EnriquecimentoEntrega = {
  local: string | null;
  prazo_dias: number | null;
};

export type EnriquecimentoRow = {
  numero_controle_pncp: string;
  status: string;
  fonte: string;
  resumo: string | null;
  categorias: string[];
  conceitos: string[];
  palavras_chave: string[];
  requisitos: EnriquecimentoRequisito[];
  exige_certificacao: boolean | null;
  exige_atestado_tecnico: boolean | null;
  me_epp_exclusivo: boolean | null;
  me_epp_preferencia: boolean | null;
  entrega: EnriquecimentoEntrega | null;
  riscos: string[];
  complexidade: string | null;
  confianca: number | null;
  modelo: string | null;
  enriquecido_em: Date;
};

/** Fetches the canonical enrichment for one licitação, or null when it hasn't
 * been enriched yet (no row) or the last attempt failed (`status = 'error'` —
 * such a row carries no usable fields, so callers treat it as absent). The
 * heavy `dados` blob is deliberately not selected: consumers (the chat tool
 * layer, the match engine) only need the derived columns. */
export async function fetchEnriquecimento(
  numero: string,
): Promise<EnriquecimentoRow | null> {
  const result = await pool.query<EnriquecimentoRow>(
    `SELECT
       numero_controle_pncp, status, fonte, resumo,
       categorias, conceitos, palavras_chave, requisitos,
       exige_certificacao, exige_atestado_tecnico,
       me_epp_exclusivo, me_epp_preferencia,
       entrega, riscos, complexidade, confianca, modelo, enriquecido_em
     FROM enriquecimento
     WHERE numero_controle_pncp = $1 AND status = 'done'`,
    [numero],
  );
  return result.rows[0] ?? null;
}
