import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a path
// alias. The pool and every query module are mocked — only the batch's own
// wiring is under test. The verdict itself is the real lib/case-verdict.ts,
// so the check lines handed to `replaceCaseChecks` are the ones production
// writes.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./analysis-queries", () => ({
  fetchAnalysis: vi.fn(),
  enqueueAnalysis: vi.fn(),
}));
vi.mock("./document-queries", () => ({ listDocuments: vi.fn() }));
vi.mock("./case-queries", () => ({
  listGoOpportunitiesWithoutCase: vi.fn(),
  insertCase: vi.fn(),
  listCasesWaitingAnalysis: vi.fn(),
  getProcurementClosesAt: vi.fn(),
  getCompanyAdminUserId: vi.fn(),
  replaceCaseChecks: vi.fn(),
  listCasesToEmail: vi.fn(),
  listCompanyAdminEmails: vi.fn(),
  stampCaseEmailed: vi.fn(),
  listCasesForResultsRequest: vi.fn(),
  requestItemResults: vi.fn(),
  stampCaseResultsRequested: vi.fn(),
  listCasesAwaitingOutcome: vi.fn(),
  fetchOutcomeEvidence: vi.fn(),
  setOutcomeFromPncp: vi.fn(),
  insertSystemFeedback: vi.fn(),
}));
vi.mock("./email/outbox", () => ({ enqueue: vi.fn() }));

import type { TenderAnalysis } from "./analysis-queries";
import { enqueueAnalysis, fetchAnalysis } from "./analysis-queries";
import { runCaseBatch } from "./case-batch";
import {
  type CaseEmailRow,
  fetchOutcomeEvidence,
  getCompanyAdminUserId,
  getProcurementClosesAt,
  insertCase,
  insertSystemFeedback,
  listCasesAwaitingOutcome,
  listCasesForResultsRequest,
  listCasesToEmail,
  listCasesWaitingAnalysis,
  listCompanyAdminEmails,
  listGoOpportunitiesWithoutCase,
  replaceCaseChecks,
  requestItemResults,
  setOutcomeFromPncp,
  stampCaseEmailed,
  stampCaseResultsRequested,
} from "./case-queries";
import { pool } from "./db";
import { listDocuments } from "./document-queries";
import { enqueue } from "./email/outbox";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const SESSION = new Date("2026-10-01T15:00:00.000Z");

function analysis(over: Partial<TenderAnalysis> = {}): TenderAnalysis {
  return {
    procurement_id: 9,
    version: 2,
    status: "done",
    error: null,
    model: "gemini",
    input_kind: "pdf",
    input_truncated: false,
    executive_summary: "resumo",
    object_text: "objeto",
    overall_risk: "medium",
    analyzed_at: new Date("2026-09-01T12:00:00.000Z"),
    facts: [],
    dates: [
      {
        sequence: 1,
        kind: "session",
        label: "Sessão pública",
        occurs_at: SESSION,
        raw_text: "01/10/2026",
        confidence: "high",
        citations: [],
      },
    ],
    requirements: [
      {
        sequence: 1,
        category: "fiscal_labor",
        title: "Regularidade com o FGTS",
        description: "CRF dentro da validade.",
        mandatory: true,
        severity: "high",
        statement_kind: "fact",
        confidence: "high",
        citations: [{ sequence: 1, page: 3 }],
      },
    ],
    penalties: [],
    risks: [],
    missing: [],
    ...over,
  };
}

function caseEmailRow(over: Partial<CaseEmailRow> = {}): CaseEmailRow {
  return {
    id: 31,
    company_id: 1,
    company_name: "Acme Ltda",
    description: "Pregão eletrônico",
    agency_name: "Prefeitura de Exemplo",
    state_uf: "SP",
    session_at: SESSION,
    met: 1,
    expiring: 0,
    missing: 2,
    manual: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // agent_runs: INSERT ... RETURNING id, then the UPDATE that closes the run.
  query.mockImplementation(async (text: string) => {
    if (text.includes("INSERT INTO agent_runs")) return { rows: [{ id: "77" }] };
    if (text.includes("UPDATE agent_runs")) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  mock(listGoOpportunitiesWithoutCase).mockResolvedValue([]);
  mock(listCasesWaitingAnalysis).mockResolvedValue([]);
  mock(insertCase).mockResolvedValue(1);
  mock(getProcurementClosesAt).mockResolvedValue(null);
  mock(getCompanyAdminUserId).mockResolvedValue(4);
  mock(listDocuments).mockResolvedValue([]);
  mock(replaceCaseChecks).mockResolvedValue(undefined);
  mock(fetchAnalysis).mockResolvedValue(null);
  mock(enqueueAnalysis).mockResolvedValue({ ok: true, job: null });
  mock(listCasesToEmail).mockResolvedValue([]);
  mock(listCompanyAdminEmails).mockResolvedValue([]);
  mock(stampCaseEmailed).mockResolvedValue(undefined);
  mock(enqueue).mockResolvedValue({ id: 1 });
  mock(listCasesForResultsRequest).mockResolvedValue([]);
  mock(requestItemResults).mockResolvedValue(undefined);
  mock(stampCaseResultsRequested).mockResolvedValue(undefined);
  mock(listCasesAwaitingOutcome).mockResolvedValue([]);
  mock(fetchOutcomeEvidence).mockResolvedValue({
    won: false,
    unsyncedItems: 1,
    resultRows: 0,
  });
  mock(setOutcomeFromPncp).mockResolvedValue(undefined);
  mock(insertSystemFeedback).mockResolvedValue(undefined);
});

function finishedRun(): { status: string; counters: Record<string, number> } {
  const call = query.mock.calls.find(([text]) =>
    String(text).includes("UPDATE agent_runs"),
  ) as [string, unknown[]];
  return {
    status: call[1][1] as string,
    counters: JSON.parse(call[1][2] as string) as Record<string, number>,
  };
}

describe("runCaseBatch", () => {
  it("opens a 'cases' run and creates one case per GO opportunity", async () => {
    mock(listGoOpportunitiesWithoutCase).mockResolvedValue([
      {
        opportunity_id: 10,
        company_id: 1,
        procurement_id: 9,
        recommendation_id: 5,
      },
      {
        opportunity_id: 11,
        company_id: 1,
        procurement_id: 12,
        recommendation_id: null,
      },
    ]);
    // The second opportunity raced another run: no row came back.
    mock(insertCase).mockResolvedValueOnce(1).mockResolvedValueOnce(null);

    const result = await runCaseBatch();

    expect(query.mock.calls[0][0]).toContain("VALUES ('cases', $1, 'running')");
    expect(insertCase).toHaveBeenCalledWith({
      companyId: 1,
      procurementId: 9,
      opportunityId: 10,
      recommendationId: 5,
    });
    expect(result.created).toBe(1);
    expect(result.runId).toBe(77);
    expect(finishedRun().status).toBe("done");
  });

  it("computes and persists the verdict when the dossier is there", async () => {
    mock(listCasesWaitingAnalysis).mockResolvedValue([
      { id: 31, company_id: 1, procurement_id: 9 },
    ]);
    mock(fetchAnalysis).mockResolvedValue(analysis());
    mock(listDocuments).mockResolvedValue([
      {
        id: 5,
        company_id: 1,
        kind: "fgts_clearance",
        file_name: "crf.pdf",
        storage_path: "1/crf.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        valid_until: new Date(2026, 11, 31),
        uploaded_by: 1,
        created_at: new Date("2026-08-01T12:00:00.000Z"),
        expired: false,
      },
    ]);

    const result = await runCaseBatch();

    expect(replaceCaseChecks).toHaveBeenCalledTimes(1);
    const [caseId, checks, meta] = mock(replaceCaseChecks).mock.calls[0];
    expect(caseId).toBe(31);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      requirement_sequence: 1,
      document_kind: "fgts_clearance",
      status: "met",
      document_id: 5,
    });
    expect(meta).toEqual({
      analysisVersion: 2,
      sessionAt: SESSION,
      sessionSource: "dossier_session",
    });
    expect(result.ready).toBe(1);
    expect(result.waiting).toBe(0);
    expect(enqueueAnalysis).not.toHaveBeenCalled();
  });

  it("asks for the dossier as the company's admin and keeps waiting", async () => {
    mock(listCasesWaitingAnalysis).mockResolvedValue([
      { id: 31, company_id: 1, procurement_id: 9 },
    ]);
    mock(fetchAnalysis).mockResolvedValue(null);
    // The per-company cap answers with an error object, never a throw.
    mock(enqueueAnalysis).mockResolvedValue({
      error: "Limite diário de análises atingido (10).",
    });

    const result = await runCaseBatch();

    expect(enqueueAnalysis).toHaveBeenCalledWith(9, 1, 4);
    expect(replaceCaseChecks).not.toHaveBeenCalled();
    expect(result.waiting).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("keeps waiting without enqueueing when the company has no admin", async () => {
    mock(listCasesWaitingAnalysis).mockResolvedValue([
      { id: 31, company_id: 1, procurement_id: 9 },
    ]);
    mock(getCompanyAdminUserId).mockResolvedValue(null);

    const result = await runCaseBatch();

    expect(enqueueAnalysis).not.toHaveBeenCalled();
    expect(result.waiting).toBe(1);
  });

  it("counts a broken case as failed and still finishes the run", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mock(listCasesWaitingAnalysis).mockResolvedValue([
      { id: 31, company_id: 1, procurement_id: 9 },
      { id: 32, company_id: 1, procurement_id: 12 },
    ]);
    mock(fetchAnalysis)
      .mockRejectedValueOnce(new Error("dossier read failed"))
      .mockResolvedValueOnce(analysis());

    const result = await runCaseBatch();

    expect(result.failed).toBe(1);
    expect(result.ready).toBe(1);
    expect(finishedRun().status).toBe("done");
    expect(finishedRun().counters.failed).toBe(1);
    spy.mockRestore();
  });

  it("forwards the company filter to every step and reports the still-zero counters", async () => {
    const result = await runCaseBatch({ companyId: 7 });

    expect(listGoOpportunitiesWithoutCase).toHaveBeenCalledWith(7);
    expect(listCasesWaitingAnalysis).toHaveBeenCalledWith(7);
    expect(listCasesToEmail).toHaveBeenCalledWith(7);
    expect(query.mock.calls[0][1]).toEqual([7]);
    expect(result).toEqual({
      runId: 77,
      created: 0,
      ready: 0,
      waiting: 0,
      emailed: 0,
      resultsRequested: 0,
      resolved: 0,
      failed: 0,
    });
  });

  it("marks the run failed and rethrows when the work list cannot be read", async () => {
    mock(listGoOpportunitiesWithoutCase).mockRejectedValue(new Error("db gone"));

    await expect(runCaseBatch()).rejects.toThrow("db gone");

    expect(finishedRun().status).toBe("failed");
  });
});

describe("runCaseBatch — case_ready email", () => {
  it("emails every admin with a distinct dedupe key, then stamps once", async () => {
    mock(listCasesToEmail).mockResolvedValue([caseEmailRow()]);
    mock(listCompanyAdminEmails).mockResolvedValue([
      "admin1@acme.com",
      "admin2@acme.com",
    ]);

    const result = await runCaseBatch();

    expect(listCompanyAdminEmails).toHaveBeenCalledWith(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
    const calls = mock(enqueue).mock.calls as [
      { toEmail: string; template: string; dedupeKey: string },
    ][];
    expect(calls.map(([input]) => input.dedupeKey)).toEqual([
      "case_ready:31:admin1@acme.com",
      "case_ready:31:admin2@acme.com",
    ]);
    expect(calls.every(([input]) => input.template === "case_ready")).toBe(true);
    expect(stampCaseEmailed).toHaveBeenCalledTimes(1);
    expect(stampCaseEmailed).toHaveBeenCalledWith(31);
    expect(result.emailed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("stamps the case even when every enqueue comes back a duplicate", async () => {
    mock(listCasesToEmail).mockResolvedValue([caseEmailRow()]);
    mock(listCompanyAdminEmails).mockResolvedValue(["admin@acme.com"]);
    mock(enqueue).mockResolvedValue({ id: null, skipped: "duplicate" });

    const result = await runCaseBatch();

    expect(stampCaseEmailed).toHaveBeenCalledWith(31);
    expect(result.emailed).toBe(0);
  });

  it("stamps a case with no admins and enqueues nothing", async () => {
    mock(listCasesToEmail).mockResolvedValue([caseEmailRow()]);
    mock(listCompanyAdminEmails).mockResolvedValue([]);

    const result = await runCaseBatch();

    expect(enqueue).not.toHaveBeenCalled();
    expect(stampCaseEmailed).toHaveBeenCalledWith(31);
    expect(result.emailed).toBe(0);
  });

  it("counts a case that throws as failed and leaves it unstamped", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mock(listCasesToEmail).mockResolvedValue([caseEmailRow()]);
    mock(listCompanyAdminEmails).mockRejectedValue(new Error("db gone"));

    const result = await runCaseBatch();

    expect(stampCaseEmailed).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(finishedRun().status).toBe("done");
    spy.mockRestore();
  });
});

describe("runCaseBatch — results request", () => {
  it("opens the PNCP queue and stamps every case whose session cleared the delay", async () => {
    mock(listCasesForResultsRequest).mockResolvedValue([
      { id: 31, procurement_id: 9 },
      { id: 32, procurement_id: 12 },
    ]);

    const result = await runCaseBatch();

    expect(listCasesForResultsRequest).toHaveBeenCalledWith();
    expect(requestItemResults).toHaveBeenNthCalledWith(1, 9);
    expect(stampCaseResultsRequested).toHaveBeenNthCalledWith(1, 31);
    expect(requestItemResults).toHaveBeenNthCalledWith(2, 12);
    expect(stampCaseResultsRequested).toHaveBeenNthCalledWith(2, 32);
    expect(result.resultsRequested).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("counts a case whose request fails, leaves it unstamped, and still finishes the run", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mock(listCasesForResultsRequest).mockResolvedValue([
      { id: 31, procurement_id: 9 },
    ]);
    mock(requestItemResults).mockRejectedValue(new Error("db gone"));

    const result = await runCaseBatch();

    expect(stampCaseResultsRequested).not.toHaveBeenCalled();
    expect(result.resultsRequested).toBe(0);
    expect(result.failed).toBe(1);
    expect(finishedRun().status).toBe("done");
    spy.mockRestore();
  });
});

describe("runCaseBatch — outcome resolution", () => {
  it("resolves won and writes the matching feedback", async () => {
    mock(listCasesAwaitingOutcome).mockResolvedValue([
      { id: 31, opportunity_id: 4 },
    ]);
    mock(fetchOutcomeEvidence).mockResolvedValue({
      won: true,
      unsyncedItems: 1,
      resultRows: 0,
    });

    const result = await runCaseBatch();

    expect(fetchOutcomeEvidence).toHaveBeenCalledWith(31);
    expect(setOutcomeFromPncp).toHaveBeenCalledWith(31, "won");
    expect(insertSystemFeedback).toHaveBeenCalledWith(4, "won", "pncp:results");
    expect(result.resolved).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("resolves lost once every item is synced and a result exists", async () => {
    mock(listCasesAwaitingOutcome).mockResolvedValue([
      { id: 31, opportunity_id: 4 },
    ]);
    mock(fetchOutcomeEvidence).mockResolvedValue({
      won: false,
      unsyncedItems: 0,
      resultRows: 1,
    });

    const result = await runCaseBatch();

    expect(setOutcomeFromPncp).toHaveBeenCalledWith(31, "lost");
    expect(insertSystemFeedback).toHaveBeenCalledWith(4, "lost", "pncp:results");
    expect(result.resolved).toBe(1);
  });

  it("writes nothing while the evidence is still partial", async () => {
    mock(listCasesAwaitingOutcome).mockResolvedValue([
      { id: 31, opportunity_id: 4 },
    ]);
    mock(fetchOutcomeEvidence).mockResolvedValue({
      won: false,
      unsyncedItems: 1,
      resultRows: 0,
    });

    const result = await runCaseBatch();

    expect(setOutcomeFromPncp).not.toHaveBeenCalled();
    expect(insertSystemFeedback).not.toHaveBeenCalled();
    expect(result.resolved).toBe(0);
  });

  it("counts a case whose evidence read fails and still finishes the run", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mock(listCasesAwaitingOutcome).mockResolvedValue([
      { id: 31, opportunity_id: 4 },
    ]);
    mock(fetchOutcomeEvidence).mockRejectedValue(new Error("db gone"));

    const result = await runCaseBatch();

    expect(setOutcomeFromPncp).not.toHaveBeenCalled();
    expect(result.resolved).toBe(0);
    expect(result.failed).toBe(1);
    expect(finishedRun().status).toBe("done");
    spy.mockRestore();
  });
});
