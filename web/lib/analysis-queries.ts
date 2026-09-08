// Read/write side of the on-demand "Analisar com IA" flow (tables
// `analysis_jobs`, `tender_analyses`). `analysis_jobs` is tenant-scoped by
// `company_id` (always from the session, never from the caller);
// `tender_analyses` is company-agnostic like `procurement_enrichments`.
//
// Every value from the outside world is bound as a parameterized
// placeholder — never string-interpolated into SQL text.

import { pool } from "./db";

export type SqlQuery = { text: string; values: unknown[] };

// Copied verbatim from `src/lixto/analyze/worker.py`'s `DOCUMENT_SET_HASH_SQL`
// (only `%(procurement_id)s` -> `$1`). Both sides must produce the same md5
// for the same set of active documents so the web app can detect, without a
// round trip through Python, whether a dossier is stale relative to the
// current document set.
export const DOCUMENT_SET_HASH_SQL = `
SELECT md5(coalesce(string_agg(
    sequence || ':' || coalesce(to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), '') || ':' || coalesce(url, ''),
    E'\\n' ORDER BY sequence), ''))
FROM procurement_documents
WHERE procurement_id = $1 AND is_active IS TRUE
`;

export type AnalysisSummary = {
  version: number;
  status: "done" | "error";
  error: string | null;
  document_set_hash: string | null;
  analyzed_at: Date;
};

export type AnalysisJob = {
  id: number;
  status: "queued" | "running" | "done" | "error";
  error: string | null;
  created_at: Date;
};

export const ANALYZE_USER_DAILY_CAP = Number(
  process.env.LIXTO_ANALYZE_USER_DAILY_CAP ?? 10,
);

export type AnalysisState = {
  analysis: AnalysisSummary | null;
  stale: boolean;
  job: AnalysisJob | null;
};

// pg returns BIGINT/BIGSERIAL columns as strings — raw shapes before
// Number()ing them.
type AnalysisSummaryDbRow = {
  version: string;
  status: "done" | "error";
  error: string | null;
  document_set_hash: string | null;
  analyzed_at: Date;
};

type AnalysisJobDbRow = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
};

function toAnalysisSummary(row: AnalysisSummaryDbRow): AnalysisSummary {
  return {
    version: Number(row.version),
    status: row.status,
    error: row.error,
    document_set_hash: row.document_set_hash,
    analyzed_at: row.analyzed_at,
  };
}

function toAnalysisJob(row: AnalysisJobDbRow): AnalysisJob {
  return {
    id: Number(row.id),
    status: row.status,
    error: row.error,
    created_at: row.created_at,
  };
}

export function buildFetchAnalysisSummary(procurementId: number): SqlQuery {
  return {
    text: `
      SELECT version, status, error, document_set_hash, analyzed_at
      FROM tender_analyses
      WHERE procurement_id = $1
    `,
    values: [procurementId],
  };
}

export function buildCurrentDocumentSetHash(procurementId: number): SqlQuery {
  return {
    text: DOCUMENT_SET_HASH_SQL,
    values: [procurementId],
  };
}

export function buildLatestJob(
  procurementId: number,
  companyId: number,
): SqlQuery {
  return {
    text: `
      SELECT id, status, error, created_at, finished_at
      FROM analysis_jobs
      WHERE procurement_id = $1 AND company_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    values: [procurementId, companyId],
  };
}

export function buildCountJobsToday(companyId: number): SqlQuery {
  return {
    text: `
      SELECT count(*)::int AS count
      FROM analysis_jobs
      WHERE company_id = $1 AND created_at >= date_trunc('day', now())
    `,
    values: [companyId],
  };
}

export function buildInsertJob(
  procurementId: number,
  companyId: number,
  userId: number,
): SqlQuery {
  return {
    text: `
      INSERT INTO analysis_jobs (procurement_id, company_id, requested_by_user_id)
      SELECT $1, $2, $3
      WHERE EXISTS (
        SELECT 1 FROM procurements
        WHERE id = $1 AND (proposal_closes_at >= now() OR proposal_opens_at > now())
      )
      RETURNING id, status, error, created_at
    `,
    values: [procurementId, companyId, userId],
  };
}

async function fetchAnalysisSummary(
  procurementId: number,
): Promise<AnalysisSummary | null> {
  const query = buildFetchAnalysisSummary(procurementId);
  const result = await pool.query<AnalysisSummaryDbRow>(
    query.text,
    query.values,
  );
  return result.rows[0] ? toAnalysisSummary(result.rows[0]) : null;
}

async function fetchCurrentDocumentSetHash(
  procurementId: number,
): Promise<string | null> {
  const query = buildCurrentDocumentSetHash(procurementId);
  const result = await pool.query<{ md5: string | null }>(
    query.text,
    query.values,
  );
  return result.rows[0]?.md5 ?? null;
}

async function fetchLatestJob(
  procurementId: number,
  companyId: number,
): Promise<AnalysisJobDbRow | null> {
  const query = buildLatestJob(procurementId, companyId);
  const result = await pool.query<AnalysisJobDbRow>(query.text, query.values);
  return result.rows[0] ?? null;
}

async function countJobsToday(companyId: number): Promise<number> {
  const query = buildCountJobsToday(companyId);
  const result = await pool.query<{ count: number }>(
    query.text,
    query.values,
  );
  return result.rows[0]?.count ?? 0;
}

// A finished job (done|error) is only surfaced to the UI for a short window
// after it finishes, so the button can show "Análise concluída" / the error
// once — after that it's just history, not something to poll or display.
const FINISHED_JOB_VISIBILITY_MS = 10 * 60 * 1000;

/** Latest job for the pair, filtered to what the UI should currently act on:
 * always surfaced while `queued`/`running`; surfaced for a `done`/`error` job
 * only while `finished_at` is within the last 10 minutes. */
export async function getActiveOrRecentJob(
  procurementId: number,
  companyId: number,
): Promise<AnalysisJob | null> {
  const row = await fetchLatestJob(procurementId, companyId);
  if (!row) return null;
  if (row.status === "queued" || row.status === "running") {
    return toAnalysisJob(row);
  }
  if (
    row.finished_at &&
    Date.now() - row.finished_at.getTime() < FINISHED_JOB_VISIBILITY_MS
  ) {
    return toAnalysisJob(row);
  }
  return null;
}

export async function getAnalysisState(
  procurementId: number,
  companyId: number,
): Promise<AnalysisState> {
  const [analysis, currentHash, job] = await Promise.all([
    fetchAnalysisSummary(procurementId),
    fetchCurrentDocumentSetHash(procurementId),
    getActiveOrRecentJob(procurementId, companyId),
  ]);

  const stale =
    analysis !== null && analysis.document_set_hash !== currentHash;

  return { analysis, stale, job };
}

export async function enqueueAnalysis(
  procurementId: number,
  companyId: number,
  userId: number,
): Promise<{ ok: true; job: AnalysisJob } | { error: string }> {
  const [activeJob, analysis, currentHash, jobsToday] = await Promise.all([
    getActiveOrRecentJob(procurementId, companyId),
    fetchAnalysisSummary(procurementId),
    fetchCurrentDocumentSetHash(procurementId),
    countJobsToday(companyId),
  ]);

  if (
    activeJob &&
    (activeJob.status === "queued" || activeJob.status === "running")
  ) {
    return { ok: true, job: activeJob };
  }

  const stale =
    analysis !== null && analysis.document_set_hash !== currentHash;
  if (analysis && analysis.status === "done" && !stale) {
    return { error: "Esta licitação já foi analisada." };
  }

  if (ANALYZE_USER_DAILY_CAP > 0 && jobsToday >= ANALYZE_USER_DAILY_CAP) {
    return {
      error: `Limite diário de análises atingido (${ANALYZE_USER_DAILY_CAP}).`,
    };
  }

  const query = buildInsertJob(procurementId, companyId, userId);
  const result = await pool.query<AnalysisJobDbRow>(query.text, query.values);
  const row = result.rows[0];
  if (!row) {
    return { error: "Só licitações abertas podem ser analisadas." };
  }
  return { ok: true, job: toAnalysisJob(row) };
}

// --- Full dossier read side (`tender_analyses` + its six child tables). ---
// Mirrors the CHECK enums of migrations/006_tender_analysis.sql. Citations
// are JSONB `[{"sequence": int, "page": int}]` — already parsed by `pg` into
// plain objects, no extra decoding needed here.

export type FactGroup = "basic" | "commercial";
export type StatementKind = "fact" | "inference";
export type Confidence = "high" | "medium" | "low";
export type Severity = "low" | "medium" | "high" | "critical";
export type OverallRisk = "low" | "medium" | "high" | "critical";
export type DateKind =
  | "proposal_deadline"
  | "session"
  | "clarification_deadline"
  | "challenge_deadline"
  | "site_visit"
  | "contract_start"
  | "delivery"
  | "other";
export type RequirementCategory =
  | "participation"
  | "legal"
  | "fiscal_labor"
  | "economic_financial"
  | "technical"
  | "specification"
  | "guarantee"
  | "other";
export type RiskKind = "risk" | "red_flag" | "contradiction" | "amendment";

export type Citation = { sequence: number; page: number };

export type AnalysisFact = {
  group: FactGroup;
  key: string;
  label: string;
  value: string;
  statement_kind: StatementKind;
  confidence: Confidence;
  citations: Citation[];
};

export type AnalysisDate = {
  sequence: number;
  kind: DateKind;
  label: string;
  occurs_at: Date | null;
  raw_text: string;
  confidence: Confidence;
  citations: Citation[];
};

export type AnalysisRequirement = {
  sequence: number;
  category: RequirementCategory;
  title: string;
  description: string;
  mandatory: boolean;
  severity: Severity;
  statement_kind: StatementKind;
  confidence: Confidence;
  citations: Citation[];
};

export type AnalysisPenalty = {
  sequence: number;
  description: string;
  basis: string | null;
  confidence: Confidence;
  citations: Citation[];
};

export type AnalysisRisk = {
  sequence: number;
  kind: RiskKind;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string | null;
  citations: Citation[];
};

export type AnalysisMissing = {
  sequence: number;
  field: string;
  note: string | null;
};

export type TenderAnalysis = {
  procurement_id: number;
  version: number;
  status: "done" | "error";
  error: string | null;
  model: string | null;
  input_kind: "structured" | "text" | "pdf";
  input_truncated: boolean;
  executive_summary: string | null;
  object_text: string | null;
  overall_risk: OverallRisk | null;
  analyzed_at: Date;
  facts: AnalysisFact[];
  dates: AnalysisDate[];
  requirements: AnalysisRequirement[];
  penalties: AnalysisPenalty[];
  risks: AnalysisRisk[];
  missing: AnalysisMissing[];
};

type TenderAnalysisHeadDbRow = {
  procurement_id: string;
  version: number;
  status: "done" | "error";
  error: string | null;
  model: string | null;
  input_kind: "structured" | "text" | "pdf";
  input_truncated: boolean;
  executive_summary: string | null;
  object_text: string | null;
  overall_risk: OverallRisk | null;
  analyzed_at: Date;
};

/** Head row of the dossier — never selects the raw `data` JSONB blob (the
 * child tables + this row are the display shape). */
export function buildFetchAnalysis(procurementId: number): SqlQuery {
  return {
    text: `
      SELECT
        procurement_id, version, status, error, model, input_kind,
        input_truncated, executive_summary, object_text, overall_risk,
        analyzed_at
      FROM tender_analyses
      WHERE procurement_id = $1
    `,
    values: [procurementId],
  };
}

export function buildFetchAnalysisFacts(procurementId: number): SqlQuery {
  return {
    text: `
      SELECT "group", key, label, value, statement_kind, confidence, citations
      FROM tender_analysis_facts
      WHERE procurement_id = $1
      ORDER BY id
    `,
    values: [procurementId],
  };
}

export function buildFetchAnalysisDates(procurementId: number): SqlQuery {
  return {
    text: `
      SELECT sequence, kind, label, occurs_at, raw_text, confidence, citations
      FROM tender_analysis_dates
      WHERE procurement_id = $1
      ORDER BY sequence
    `,
    values: [procurementId],
  };
}

export function buildFetchAnalysisRequirements(
  procurementId: number,
): SqlQuery {
  return {
    text: `
      SELECT
        sequence, category, title, description, mandatory, severity,
        statement_kind, confidence, citations
      FROM tender_analysis_requirements
      WHERE procurement_id = $1
      ORDER BY sequence
    `,
    values: [procurementId],
  };
}

export function buildFetchAnalysisPenalties(procurementId: number): SqlQuery {
  return {
    text: `
      SELECT sequence, description, basis, confidence, citations
      FROM tender_analysis_penalties
      WHERE procurement_id = $1
      ORDER BY sequence
    `,
    values: [procurementId],
  };
}

export function buildFetchAnalysisRisks(procurementId: number): SqlQuery {
  return {
    text: `
      SELECT sequence, kind, severity, title, description, recommendation, citations
      FROM tender_analysis_risks
      WHERE procurement_id = $1
      ORDER BY sequence
    `,
    values: [procurementId],
  };
}

export function buildFetchAnalysisMissing(procurementId: number): SqlQuery {
  return {
    text: `
      SELECT sequence, field, note
      FROM tender_analysis_missing
      WHERE procurement_id = $1
      ORDER BY sequence
    `,
    values: [procurementId],
  };
}

async function fetchAnalysisHead(
  procurementId: number,
): Promise<TenderAnalysisHeadDbRow | null> {
  const query = buildFetchAnalysis(procurementId);
  const result = await pool.query<TenderAnalysisHeadDbRow>(
    query.text,
    query.values,
  );
  return result.rows[0] ?? null;
}

async function fetchAnalysisFacts(
  procurementId: number,
): Promise<AnalysisFact[]> {
  const query = buildFetchAnalysisFacts(procurementId);
  const result = await pool.query<AnalysisFact>(query.text, query.values);
  return result.rows;
}

async function fetchAnalysisDates(
  procurementId: number,
): Promise<AnalysisDate[]> {
  const query = buildFetchAnalysisDates(procurementId);
  const result = await pool.query<AnalysisDate>(query.text, query.values);
  return result.rows;
}

async function fetchAnalysisRequirements(
  procurementId: number,
): Promise<AnalysisRequirement[]> {
  const query = buildFetchAnalysisRequirements(procurementId);
  const result = await pool.query<AnalysisRequirement>(
    query.text,
    query.values,
  );
  return result.rows;
}

async function fetchAnalysisPenalties(
  procurementId: number,
): Promise<AnalysisPenalty[]> {
  const query = buildFetchAnalysisPenalties(procurementId);
  const result = await pool.query<AnalysisPenalty>(query.text, query.values);
  return result.rows;
}

async function fetchAnalysisRisks(
  procurementId: number,
): Promise<AnalysisRisk[]> {
  const query = buildFetchAnalysisRisks(procurementId);
  const result = await pool.query<AnalysisRisk>(query.text, query.values);
  return result.rows;
}

async function fetchAnalysisMissing(
  procurementId: number,
): Promise<AnalysisMissing[]> {
  const query = buildFetchAnalysisMissing(procurementId);
  const result = await pool.query<AnalysisMissing>(query.text, query.values);
  return result.rows;
}

/** The full cited dossier for a procurement, or null when there is no row yet
 * or the last attempt failed (`status = 'error'` carries no display fields).
 * The six child tables are fetched together — none of them can meaningfully
 * exist without the head row. */
export async function fetchAnalysis(
  procurementId: number,
): Promise<TenderAnalysis | null> {
  const head = await fetchAnalysisHead(procurementId);
  if (!head || head.status === "error") return null;

  const [facts, dates, requirements, penalties, risks, missing] =
    await Promise.all([
      fetchAnalysisFacts(procurementId),
      fetchAnalysisDates(procurementId),
      fetchAnalysisRequirements(procurementId),
      fetchAnalysisPenalties(procurementId),
      fetchAnalysisRisks(procurementId),
      fetchAnalysisMissing(procurementId),
    ]);

  return {
    procurement_id: Number(head.procurement_id),
    version: head.version,
    status: head.status,
    error: head.error,
    model: head.model,
    input_kind: head.input_kind,
    input_truncated: head.input_truncated,
    executive_summary: head.executive_summary,
    object_text: head.object_text,
    overall_risk: head.overall_risk,
    analyzed_at: head.analyzed_at,
    facts,
    dates,
    requirements,
    penalties,
    risks,
    missing,
  };
}
