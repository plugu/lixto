// SQL for the licitação detail page's agent-analysis panel (ticket 15).
// Mirrors detail-queries.ts's pattern: server-only, uses the shared db.ts pool.
//
// Schema: migrations/006_analise.sql. requirements/prazos/risks are JSONB
// columns — node-pg parses them into plain JS values automatically.

import { pool } from "./db";

export type Requirement = {
  tipo: string;
  descricao: string;
  atende: "sim" | "nao" | "incerto";
};

export type Prazo = {
  evento: string;
  data: string;
};

export type AnaliseVerdict = "fit" | "no_fit" | "borderline";

export type DeepStatus = "done" | "skipped" | "error";

export type AnaliseRow = {
  numero_controle_pncp: string;
  fit_score: number | null;
  verdict: AnaliseVerdict | null;
  reasoning: string | null;
  triage_model: string | null;
  triaged_at: Date | null;
  deep_verdict: string | null;
  requirements: Requirement[] | null;
  risks: string[] | null;
  prazos: Prazo[] | null;
  deep_model: string | null;
  deep_analyzed_at: Date | null;
  deep_status: DeepStatus | null;
  error: string | null;
};

/** Fetches the agent's triage + deep-analysis verdict for one licitação, or
 * null when it hasn't been analysed (no row in `analise`). */
export async function fetchAnalise(
  numeroControlePncp: string,
): Promise<AnaliseRow | null> {
  const result = await pool.query<AnaliseRow>(
    `SELECT
       numero_controle_pncp, fit_score, verdict, reasoning, triage_model, triaged_at,
       deep_verdict, requirements, risks, prazos, deep_model, deep_analyzed_at,
       deep_status, error
     FROM analise
     WHERE numero_controle_pncp = $1`,
    [numeroControlePncp],
  );
  return result.rows[0] ?? null;
}
