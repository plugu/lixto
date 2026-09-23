// Persistence for the case agent (PRODUCT, cycle 30): the `cases` and
// `case_checks` tables of migrations/008_cases.sql.
//
// Two families live here on purpose:
//  - tenant-scoped reads/writes (`buildListCases`, `buildGetCase`,
//    `buildListCaseChecks`, `buildDecideCase`) — `company_id` is always bound
//    as $1, always from the session, never from the request (docs/TENANT.md);
//  - batch helpers used by lib/case-batch.ts, which runs globally or for one
//    operator-chosen company and therefore takes an *optional* company id.
//
// Every value from the outside world is bound as a parameterized placeholder
// — never string-interpolated into SQL text. Relative imports (not
// "@/lib/...") on purpose: vitest resolves no alias for lib tests.

import type { Citation, RequirementCategory, Severity } from "./analysis-queries";
import { RESULTS_DELAY_DAYS, type OutcomeEvidence } from "./case-outcome";
import { type CaseCheck, type CheckStatus, type SessionSource, dateKey } from "./case-verdict";
import { pool } from "./db";
import type { DocumentKind } from "./types";

export type SqlQuery = { text: string; values: unknown[] };

export type CaseStatus = "waiting_analysis" | "ready" | "decided";
export type CaseDecision = "submit" | "skip" | "missing_document";
export type CaseOutcome = "won" | "lost" | "disqualified";
export type CaseOutcomeSource = "pncp" | "operator";

/** A case plus the procurement facts and verdict counts every list/detail
 * screen needs — one query, no N+1 per row. */
export type CaseRow = {
  id: number;
  company_id: number;
  procurement_id: number;
  opportunity_id: number;
  recommendation_id: number | null;
  status: CaseStatus;
  analysis_version: number | null;
  session_at: Date | null;
  session_source: SessionSource | null;
  email_enqueued_at: Date | null;
  decision: CaseDecision | null;
  decision_note: string | null;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  results_requested_at: Date | null;
  outcome: CaseOutcome | null;
  outcome_source: CaseOutcomeSource | null;
  outcome_at: Date | null;
  created_at: Date;
  updated_at: Date;
  source_id: string;
  description: string | null;
  agency_name: string | null;
  /** `procurements.state` (UF) — renamed so it cannot be read as a lifecycle
   * state. */
  state_uf: string | null;
  city_name: string | null;
  modality_name: string | null;
  estimated_value: string | null;
  proposal_closes_at: Date | null;
  met: number;
  expiring: number;
  missing: number;
  manual: number;
};

/** One persisted verdict line (`case_checks`). */
export type CaseCheckRow = {
  id: number;
  case_id: number;
  requirement_sequence: number;
  category: RequirementCategory;
  title: string;
  mandatory: boolean;
  severity: Severity;
  citations: Citation[];
  document_kind: DocumentKind | null;
  status: CheckStatus;
  document_id: number | null;
  document_file_name: string | null;
  document_valid_until: Date | null;
};

/** A GO opportunity that has no case yet — the batch's work list. */
export type GoOpportunityRow = {
  opportunity_id: number;
  company_id: number;
  procurement_id: number;
  recommendation_id: number | null;
};

/** A case still waiting for its procurement's dossier. */
export type WaitingCaseRow = {
  id: number;
  company_id: number;
  procurement_id: number;
};

/** A `ready`, not-yet-emailed case — everything `case-batch.ts` needs to
 * build the `case_ready` payload without a second round trip per row. */
export type CaseEmailRow = {
  id: number;
  company_id: number;
  company_name: string;
  description: string | null;
  agency_name: string | null;
  state_uf: string | null;
  session_at: Date | null;
  met: number;
  expiring: number;
  missing: number;
  manual: number;
};

export type NewCase = {
  companyId: number;
  procurementId: number;
  opportunityId: number;
  recommendationId: number | null;
};

export type CaseChecksMeta = {
  analysisVersion: number;
  sessionAt: Date | null;
  sessionSource: SessionSource | null;
};

/** A submitted case whose session has cleared `RESULTS_DELAY_DAYS`
 * (case-outcome.ts) and whose items have never been requested — the
 * results-request work list. */
export type ResultsRequestCandidate = {
  id: number;
  procurement_id: number;
};

/** A submitted case whose items are on the results queue but whose outcome
 * is still unknown — the outcome-resolution work list. */
export type OutcomeCandidate = {
  id: number;
  opportunity_id: number;
};

// pg returns BIGINT/BIGSERIAL columns as strings — raw shapes before
// Number()ing them.
type CaseDbRow = Omit<
  CaseRow,
  | "id"
  | "company_id"
  | "procurement_id"
  | "opportunity_id"
  | "recommendation_id"
  | "decided_by"
  | "met"
  | "expiring"
  | "missing"
  | "manual"
> & {
  id: string;
  company_id: string;
  procurement_id: string;
  opportunity_id: string;
  recommendation_id: string | null;
  decided_by: string | null;
  met: string;
  expiring: string;
  missing: string;
  manual: string;
};

type CaseCheckDbRow = Omit<CaseCheckRow, "id" | "case_id" | "document_id"> & {
  id: string;
  case_id: string;
  document_id: string | null;
};

type CaseEmailDbRow = Omit<
  CaseEmailRow,
  "id" | "company_id" | "met" | "expiring" | "missing" | "manual"
> & {
  id: string;
  company_id: string;
  met: string;
  expiring: string;
  missing: string;
  manual: string;
};

const CASE_COUNTS = (["met", "expiring", "missing", "manual"] as const)
  .map(
    (status) =>
      `(SELECT count(*) FROM case_checks k WHERE k.case_id = c.id AND k.status = '${status}') AS ${status}`,
  )
  .join(",\n           ");

// `agencies` is joined on the denormalized tax id, exactly as
// lib/opportunity-queries.ts does — the agency name is not on `procurements`.
const CASE_SELECT = `
    SELECT c.id,
           c.company_id,
           c.procurement_id,
           c.opportunity_id,
           c.recommendation_id,
           c.status,
           c.analysis_version,
           c.session_at,
           c.session_source,
           c.email_enqueued_at,
           c.decision,
           c.decision_note,
           c.decided_by,
           u.name AS decided_by_name,
           c.decided_at,
           c.results_requested_at,
           c.outcome,
           c.outcome_source,
           c.outcome_at,
           c.created_at,
           c.updated_at,
           p.source_id,
           p.description,
           a.name AS agency_name,
           p.state AS state_uf,
           p.city_name,
           p.modality_name,
           p.estimated_value,
           p.proposal_closes_at,
           ${CASE_COUNTS}
      FROM cases c
      JOIN procurements p ON p.id = c.procurement_id
      LEFT JOIN agencies a ON a.tax_id = p.agency_tax_id
      LEFT JOIN users u ON u.id = c.decided_by`;

// Open cases first (a decided one is history), then the nearest session, then
// newest — the order the operator works them in.
const CASE_ORDER = `
     ORDER BY (c.status = 'decided'), c.session_at NULLS LAST, c.id DESC`;

function toCaseRow(row: CaseDbRow): CaseRow {
  return {
    ...row,
    id: Number(row.id),
    company_id: Number(row.company_id),
    procurement_id: Number(row.procurement_id),
    opportunity_id: Number(row.opportunity_id),
    recommendation_id:
      row.recommendation_id === null ? null : Number(row.recommendation_id),
    decided_by: row.decided_by === null ? null : Number(row.decided_by),
    met: Number(row.met),
    expiring: Number(row.expiring),
    missing: Number(row.missing),
    manual: Number(row.manual),
  };
}

function toCaseCheckRow(row: CaseCheckDbRow): CaseCheckRow {
  return {
    ...row,
    id: Number(row.id),
    case_id: Number(row.case_id),
    document_id: row.document_id === null ? null : Number(row.document_id),
  };
}

function toCaseEmailRow(row: CaseEmailDbRow): CaseEmailRow {
  return {
    ...row,
    id: Number(row.id),
    company_id: Number(row.company_id),
    met: Number(row.met),
    expiring: Number(row.expiring),
    missing: Number(row.missing),
    manual: Number(row.manual),
  };
}

export function buildListCases(companyId: number): SqlQuery {
  return {
    text: `${CASE_SELECT}
     WHERE c.company_id = $1${CASE_ORDER}`,
    values: [companyId],
  };
}

export function buildGetCase(companyId: number, id: number): SqlQuery {
  return {
    text: `${CASE_SELECT}
     WHERE c.company_id = $1 AND c.id = $2`,
    values: [companyId, id],
  };
}

/** The join to `cases` is what scopes the checks: `case_checks` carries no
 * company id of its own. */
export function buildListCaseChecks(
  companyId: number,
  caseId: number,
): SqlQuery {
  return {
    text: `
      SELECT k.id,
             k.case_id,
             k.requirement_sequence,
             k.category,
             k.title,
             k.mandatory,
             k.severity,
             k.citations,
             k.document_kind,
             k.status,
             k.document_id,
             k.document_file_name,
             k.document_valid_until
        FROM case_checks k
        JOIN cases c ON c.id = k.case_id
       WHERE c.company_id = $1 AND k.case_id = $2
       ORDER BY k.requirement_sequence, k.document_kind NULLS LAST, k.id
    `,
    values: [companyId, caseId],
  };
}

/** The operator's single answer. `status = 'ready'` in the WHERE makes it a
 * one-way door: a case cannot be decided twice, nor before its verdict is
 * computed. */
export function buildDecideCase(
  companyId: number,
  caseId: number,
  userId: number,
  decision: CaseDecision,
  note: string | null,
): SqlQuery {
  return {
    text: `
      UPDATE cases
         SET status = 'decided',
             decision = $4,
             decision_note = $5,
             decided_by = $3,
             decided_at = now(),
             updated_at = now()
       WHERE id = $2 AND company_id = $1 AND status = 'ready'
       RETURNING opportunity_id
    `,
    values: [companyId, caseId, userId, decision, note],
  };
}

/** The operator's correction, any time after "Vou enviar" — unlike
 * `buildDecideCase` this carries no `outcome IS NULL` guard: a wrong
 * PNCP-derived `won`/`lost` must still be correctable to `disqualified`. */
export function buildSetOutcomeByOperator(
  companyId: number,
  caseId: number,
): SqlQuery {
  return {
    text: `
      UPDATE cases
         SET outcome = 'disqualified',
             outcome_source = 'operator',
             outcome_at = now(),
             updated_at = now()
       WHERE id = $2 AND company_id = $1 AND decision = 'submit'
       RETURNING opportunity_id
    `,
    values: [companyId, caseId],
  };
}

export async function listCases(companyId: number): Promise<CaseRow[]> {
  const query = buildListCases(companyId);
  const result = await pool.query<CaseDbRow>(query.text, query.values);
  return result.rows.map(toCaseRow);
}

export async function getCase(
  companyId: number,
  id: number,
): Promise<CaseRow | null> {
  const query = buildGetCase(companyId, id);
  const result = await pool.query<CaseDbRow>(query.text, query.values);
  return result.rows[0] ? toCaseRow(result.rows[0]) : null;
}

export async function listCaseChecks(
  companyId: number,
  caseId: number,
): Promise<CaseCheckRow[]> {
  const query = buildListCaseChecks(companyId, caseId);
  const result = await pool.query<CaseCheckDbRow>(query.text, query.values);
  return result.rows.map(toCaseCheckRow);
}

/** Returns the decided case's `opportunity_id`, or null when nothing matched
 * (wrong company, unknown id, or already decided). */
export async function decideCase(
  companyId: number,
  caseId: number,
  userId: number,
  decision: CaseDecision,
  note: string | null,
): Promise<{ opportunity_id: number } | null> {
  const query = buildDecideCase(companyId, caseId, userId, decision, note);
  const result = await pool.query<{ opportunity_id: string }>(
    query.text,
    query.values,
  );
  const row = result.rows[0];
  return row ? { opportunity_id: Number(row.opportunity_id) } : null;
}

/** Returns the corrected case's `opportunity_id`, or null when nothing
 * matched (wrong company, unknown id, or the case never got a "Vou enviar"
 * answer). */
export async function setOutcomeByOperator(
  companyId: number,
  caseId: number,
): Promise<{ opportunity_id: number } | null> {
  const query = buildSetOutcomeByOperator(companyId, caseId);
  const result = await pool.query<{ opportunity_id: string }>(
    query.text,
    query.values,
  );
  const row = result.rows[0];
  return row ? { opportunity_id: Number(row.opportunity_id) } : null;
}

// ----------------------------------------------------------------- batch side

/**
 * Every still-live opportunity whose *newest* recommendation says go and that
 * has no case yet. `NOT EXISTS` is what makes the batch idempotent: a second
 * run the same day creates nothing. A closed procurement is skipped — a case
 * nobody can act on is noise.
 */
export function buildListGoOpportunitiesWithoutCase(
  companyId?: number,
): SqlQuery {
  return {
    text: `
      SELECT o.id AS opportunity_id, o.company_id, o.procurement_id, r.id AS recommendation_id
        FROM opportunities o
        JOIN LATERAL (SELECT id, verdict FROM recommendations WHERE opportunity_id = o.id ORDER BY created_at DESC, id DESC LIMIT 1) r ON true
        JOIN procurements p ON p.id = o.procurement_id
       WHERE r.verdict = 'go' AND o.state <> 'dismissed'
         AND (p.proposal_closes_at >= now() OR p.proposal_opens_at > now())
         AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.opportunity_id = o.id)
         AND ($1::bigint IS NULL OR o.company_id = $1)
       ORDER BY o.company_id, o.id
    `,
    values: [companyId ?? null],
  };
}

export async function listGoOpportunitiesWithoutCase(
  companyId?: number,
): Promise<GoOpportunityRow[]> {
  const query = buildListGoOpportunitiesWithoutCase(companyId);
  const result = await pool.query<{
    opportunity_id: string;
    company_id: string;
    procurement_id: string;
    recommendation_id: string | null;
  }>(query.text, query.values);
  return result.rows.map((row) => ({
    opportunity_id: Number(row.opportunity_id),
    company_id: Number(row.company_id),
    procurement_id: Number(row.procurement_id),
    recommendation_id:
      row.recommendation_id === null ? null : Number(row.recommendation_id),
  }));
}

/** Creates the case, or returns null when one already exists for the
 * opportunity (the UNIQUE constraint is the real guard against a double
 * run). */
export async function insertCase(input: NewCase): Promise<number | null> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO cases (company_id, procurement_id, opportunity_id, recommendation_id)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (opportunity_id) DO NOTHING
       RETURNING id`,
    [
      input.companyId,
      input.procurementId,
      input.opportunityId,
      input.recommendationId,
    ],
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

export async function listCasesWaitingAnalysis(
  companyId?: number,
): Promise<WaitingCaseRow[]> {
  const result = await pool.query<{
    id: string;
    company_id: string;
    procurement_id: string;
  }>(
    `SELECT id, company_id, procurement_id
       FROM cases
      WHERE status = 'waiting_analysis'
        AND ($1::bigint IS NULL OR company_id = $1)
      ORDER BY company_id, id`,
    [companyId ?? null],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    company_id: Number(row.company_id),
    procurement_id: Number(row.procurement_id),
  }));
}

export async function getProcurementClosesAt(
  procurementId: number,
): Promise<Date | null> {
  const result = await pool.query<{ proposal_closes_at: Date | null }>(
    `SELECT proposal_closes_at FROM procurements WHERE id = $1`,
    [procurementId],
  );
  return result.rows[0]?.proposal_closes_at ?? null;
}

/** The company's oldest admin — the user an automatic `analysis_jobs` row is
 * attributed to (the table requires a requester). Null when the company has
 * no admin, in which case the batch simply keeps waiting. */
export async function getCompanyAdminUserId(
  companyId: number,
): Promise<number | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE company_id = $1 AND role = 'admin' ORDER BY id LIMIT 1`,
    [companyId],
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

/**
 * Replaces a case's whole verdict and flips it to `ready`, in one
 * transaction: a half-written verdict (old lines deleted, new ones not in
 * yet) must never be visible to the case page. Delete + insert rather than
 * upsert because the set of lines itself changes when documents are uploaded
 * or the dossier is re-extracted.
 */
export async function replaceCaseChecks(
  caseId: number,
  checks: CaseCheck[],
  meta: CaseChecksMeta,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM case_checks WHERE case_id = $1`, [caseId]);

    if (checks.length > 0) {
      const values: unknown[] = [];
      const tuples = checks.map((check) => {
        const base = values.length;
        values.push(
          caseId,
          check.requirement_sequence,
          check.category,
          check.title,
          check.mandatory,
          check.severity,
          JSON.stringify(check.citations),
          check.document_kind,
          check.status,
          check.document_id,
          check.document_file_name,
          // DATE column: bind the calendar day, never an instant, so the
          // database's timezone cannot move a validade by one day.
          check.document_valid_until === null
            ? null
            : dateKey(check.document_valid_until, false),
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`;
      });

      await client.query(
        `INSERT INTO case_checks
           (case_id, requirement_sequence, category, title, mandatory, severity, citations,
            document_kind, status, document_id, document_file_name, document_valid_until)
          VALUES ${tuples.join(", ")}`,
        values,
      );
    }

    await client.query(
      `UPDATE cases
          SET status = 'ready',
              analysis_version = $2,
              session_at = $3,
              session_source = $4,
              updated_at = now()
        WHERE id = $1`,
      [caseId, meta.analysisVersion, meta.sessionAt, meta.sessionSource],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Every case ready for its one `case_ready` email: `status = 'ready'` and
 * never stamped. Reuses `CASE_COUNTS` so the numbers in the email always
 * match what the case page shows. `companyId` is the batch's operator-chosen
 * filter (never a session value — this is the batch side, see the file
 * banner).
 */
export function buildListCasesToEmail(companyId?: number): SqlQuery {
  return {
    text: `
      SELECT c.id,
             c.company_id,
             COALESCE(NULLIF(co.trade_name, ''), co.legal_name) AS company_name,
             p.description,
             a.name AS agency_name,
             p.state AS state_uf,
             c.session_at,
             ${CASE_COUNTS}
        FROM cases c
        JOIN companies co ON co.id = c.company_id
        JOIN procurements p ON p.id = c.procurement_id
        LEFT JOIN agencies a ON a.tax_id = p.agency_tax_id
       WHERE c.status = 'ready' AND c.email_enqueued_at IS NULL
         AND ($1::bigint IS NULL OR c.company_id = $1)
       ORDER BY c.company_id, c.id
    `,
    values: [companyId ?? null],
  };
}

export async function listCasesToEmail(
  companyId?: number,
): Promise<CaseEmailRow[]> {
  const query = buildListCasesToEmail(companyId);
  const result = await pool.query<CaseEmailDbRow>(query.text, query.values);
  return result.rows.map(toCaseEmailRow);
}

/** Every admin's email for a company — one `case_ready` row per address.
 * `users.email` is `NOT NULL`, same guarantee `email/digest-batch.ts` relies
 * on, so no extra filter is needed here. */
export async function listCompanyAdminEmails(
  companyId: number,
): Promise<string[]> {
  const result = await pool.query<{ email: string }>(
    `SELECT email FROM users WHERE company_id = $1 AND role = 'admin' ORDER BY id`,
    [companyId],
  );
  return result.rows.map((row) => row.email);
}

/** Marks a case's `case_ready` email as sent (enqueued), so the next batch
 * pass skips it — idempotent whether or not any admin actually got mail
 * (zero admins, or every `enqueue` came back a duplicate). */
export async function stampCaseEmailed(caseId: number): Promise<void> {
  await pool.query(
    `UPDATE cases SET email_enqueued_at = now(), updated_at = now() WHERE id = $1`,
    [caseId],
  );
}

// ------------------------------------------------------- results & outcome
//
// Both work lists below (`listCasesForResultsRequest`,
// `listCasesAwaitingOutcome`) take no company id: unlike the sections above,
// results are demand-driven off `cases.session_at` / `results_requested_at`
// alone (PRODUCT §Repo facts) and sweep every company every pass, the same
// way `src/lixto/sync/results.py` drains its queue globally.

/**
 * Every submitted case whose session cleared `days` (default
 * `RESULTS_DELAY_DAYS`, case-outcome.ts) ago and whose items were never
 * requested — case-batch.ts's results-request work list.
 */
export function buildListCasesForResultsRequest(
  days: number = RESULTS_DELAY_DAYS,
): SqlQuery {
  return {
    text: `
      SELECT id, procurement_id
        FROM cases
       WHERE decision = 'submit'
         AND results_requested_at IS NULL
         AND session_at IS NOT NULL
         AND session_at < now() - make_interval(days => $1)
    `,
    values: [days],
  };
}

export async function listCasesForResultsRequest(
  days: number = RESULTS_DELAY_DAYS,
): Promise<ResultsRequestCandidate[]> {
  const query = buildListCasesForResultsRequest(days);
  const result = await pool.query<{ id: string; procurement_id: string }>(
    query.text,
    query.values,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    procurement_id: Number(row.procurement_id),
  }));
}

/** Opens the PNCP results demand queue (`procurement_items.results_requested_at`,
 * the same column `lixto results sync` drains, src/lixto/sync/results.py) for
 * one procurement's items. Items already requested or already synced are
 * left alone, so two cases sharing a procurement (two companies, same
 * tender) never re-request an item mid-fetch. */
export async function requestItemResults(
  procurementId: number,
): Promise<void> {
  await pool.query(
    `UPDATE procurement_items
        SET results_requested_at = now(), updated_at = now()
      WHERE procurement_id = $1
        AND results_requested_at IS NULL
        AND results_synced_at IS NULL`,
    [procurementId],
  );
}

/** Marks a case as having entered the results queue, so the next batch pass
 * does not request its items again. */
export async function stampCaseResultsRequested(
  caseId: number,
): Promise<void> {
  await pool.query(
    `UPDATE cases SET results_requested_at = now(), updated_at = now() WHERE id = $1`,
    [caseId],
  );
}

/** Every submitted case whose items are on the results queue but whose
 * outcome is still unknown — case-batch.ts's outcome-resolution work list. */
export async function listCasesAwaitingOutcome(): Promise<OutcomeCandidate[]> {
  const result = await pool.query<{ id: string; opportunity_id: string }>(
    `SELECT id, opportunity_id
       FROM cases
      WHERE decision = 'submit'
        AND results_requested_at IS NOT NULL
        AND outcome IS NULL`,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    opportunity_id: Number(row.opportunity_id),
  }));
}

/**
 * Reads whatever `procurement_results` knows so far about a case's
 * procurement: whether the company's own tax id (`companies.tax_id`, 14
 * digits) is a winner on any item — `procurement_results.supplier_tax_id`
 * (PNCP's `niFornecedor`) may carry punctuation, so both sides are compared
 * digits-only — how many of the procurement's items are still unsynced, and
 * how many non-cancelled result rows exist across every item.
 * `decideOutcome` (case-outcome.ts) turns this into a verdict; this function
 * only reads, and only ever from evidence covering every item.
 */
export async function fetchOutcomeEvidence(
  caseId: number,
): Promise<OutcomeEvidence> {
  const result = await pool.query<{
    won: boolean | null;
    unsynced_items: string;
    result_rows: string;
  }>(
    `SELECT bool_or(r.supplier_tax_id IS NOT NULL AND regexp_replace(r.supplier_tax_id, '\\D', '', 'g') = c.tax_id) AS won,
            count(*) FILTER (WHERE i.results_synced_at IS NULL) AS unsynced_items,
            count(r.procurement_id) AS result_rows
       FROM cases cs
       JOIN companies c ON c.id = cs.company_id
       JOIN procurement_items i ON i.procurement_id = cs.procurement_id
       LEFT JOIN procurement_results r ON r.procurement_id = i.procurement_id AND r.item_number = i.item_number AND r.cancelled_at IS NULL
      WHERE cs.id = $1
      GROUP BY cs.id`,
    [caseId],
  );
  const row = result.rows[0];
  return {
    won: row?.won ?? false,
    unsyncedItems: Number(row?.unsynced_items ?? 0),
    resultRows: Number(row?.result_rows ?? 0),
  };
}

/** Persists a PNCP-derived outcome. `outcome IS NULL` makes this a one-way
 * door, the same idiom as `buildDecideCase`'s `status = 'ready'`: a case
 * already resolved — by an earlier pass, or by the operator — is never
 * overwritten. */
export async function setOutcomeFromPncp(
  caseId: number,
  outcome: "won" | "lost",
): Promise<void> {
  await pool.query(
    `UPDATE cases
        SET outcome = $2, outcome_source = 'pncp', outcome_at = now(), updated_at = now()
      WHERE id = $1 AND outcome IS NULL`,
    [caseId, outcome],
  );
}

/** Writes a feedback row with no acting user — the batch resolved this
 * outcome from PNCP data, not from an operator click. `user_id` is nullable
 * on `opportunity_feedback` for exactly this case. */
export async function insertSystemFeedback(
  opportunityId: number,
  kind: "won" | "lost",
  reason: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO opportunity_feedback (opportunity_id, user_id, kind, reason)
          VALUES ($1, NULL, $2, $3)`,
    [opportunityId, kind, reason],
  );
}
