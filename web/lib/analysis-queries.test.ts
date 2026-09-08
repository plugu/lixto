import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import {
  ANALYZE_USER_DAILY_CAP,
  buildCountJobsToday,
  buildCurrentDocumentSetHash,
  buildFetchAnalysis,
  buildFetchAnalysisDates,
  buildFetchAnalysisFacts,
  buildFetchAnalysisMissing,
  buildFetchAnalysisPenalties,
  buildFetchAnalysisRequirements,
  buildFetchAnalysisRisks,
  buildFetchAnalysisSummary,
  buildInsertJob,
  buildLatestJob,
  DOCUMENT_SET_HASH_SQL,
  enqueueAnalysis,
  fetchAnalysis,
} from "./analysis-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const PROCUREMENT_ID = 77;
const COMPANY_ID = 7;
const USER_ID = 3;

beforeEach(() => {
  query.mockReset();
});

describe("ANALYZE_USER_DAILY_CAP", () => {
  it("defaults to 10 when LIXTO_ANALYZE_USER_DAILY_CAP is unset", () => {
    expect(ANALYZE_USER_DAILY_CAP).toBe(10);
  });
});

describe("DOCUMENT_SET_HASH_SQL", () => {
  it("matches the Python md5 aggregate over active documents", () => {
    expect(DOCUMENT_SET_HASH_SQL).toContain("md5(coalesce(string_agg(");
    expect(DOCUMENT_SET_HASH_SQL).toContain(
      "WHERE procurement_id = $1 AND is_active IS TRUE",
    );
    expect(DOCUMENT_SET_HASH_SQL).not.toContain("%(procurement_id)s");
  });
});

describe("buildFetchAnalysisSummary", () => {
  it("selects the dossier summary bound on procurement_id", () => {
    const query = buildFetchAnalysisSummary(PROCUREMENT_ID);
    expect(query.text).toContain("FROM tender_analyses");
    expect(query.text).toContain("WHERE procurement_id = $1");
    expect(query.values).toEqual([PROCUREMENT_ID]);
  });
});

describe("buildCurrentDocumentSetHash", () => {
  it("reuses DOCUMENT_SET_HASH_SQL bound on procurement_id", () => {
    const query = buildCurrentDocumentSetHash(PROCUREMENT_ID);
    expect(query.text).toBe(DOCUMENT_SET_HASH_SQL);
    expect(query.values).toEqual([PROCUREMENT_ID]);
  });
});

describe("buildLatestJob", () => {
  it("binds both procurement_id and company_id, newest first", () => {
    const query = buildLatestJob(PROCUREMENT_ID, COMPANY_ID);
    expect(query.text).toContain("WHERE procurement_id = $1 AND company_id = $2");
    expect(query.text).toContain("ORDER BY created_at DESC");
    expect(query.text).toContain("LIMIT 1");
    expect(query.values).toEqual([PROCUREMENT_ID, COMPANY_ID]);
  });
});

describe("buildCountJobsToday", () => {
  it("counts every status since the start of the day, bound on company_id", () => {
    const query = buildCountJobsToday(COMPANY_ID);
    expect(query.text).toContain("WHERE company_id = $1");
    expect(query.text).toContain("date_trunc('day', now())");
    expect(query.text).not.toContain("status =");
    expect(query.values).toEqual([COMPANY_ID]);
  });
});

describe("buildInsertJob", () => {
  it("only inserts when the procurement is open or upcoming", () => {
    const query = buildInsertJob(PROCUREMENT_ID, COMPANY_ID, USER_ID);
    expect(query.text).toContain("INSERT INTO analysis_jobs");
    expect(query.text).toContain("WHERE EXISTS");
    expect(query.text).toContain(
      "proposal_closes_at >= now() OR proposal_opens_at > now()",
    );
    expect(query.text).toContain("RETURNING id, status, error, created_at");
    expect(query.values).toEqual([PROCUREMENT_ID, COMPANY_ID, USER_ID]);
  });
});

function jobRow(over: Record<string, unknown> = {}) {
  return {
    id: "1",
    status: "queued",
    error: null,
    created_at: new Date("2026-09-07T10:00:00Z"),
    finished_at: null,
    ...over,
  };
}

function analysisRow(over: Record<string, unknown> = {}) {
  return {
    version: "1",
    status: "done",
    error: null,
    document_set_hash: "abc",
    analyzed_at: new Date("2026-09-01T10:00:00Z"),
    ...over,
  };
}

// enqueueAnalysis issues, in order: latest job, analysis summary, current
// document hash, jobs-today count, and (only if none of those short-circuit)
// the guarded insert. Each test seeds exactly the calls it needs via
// mockResolvedValueOnce in that order.
describe("enqueueAnalysis", () => {
  it("short-circuits and returns the active job when one is queued/running", async () => {
    query
      .mockResolvedValueOnce({ rows: [jobRow({ status: "running" })] }) // latest job
      .mockResolvedValueOnce({ rows: [] }) // analysis summary
      .mockResolvedValueOnce({ rows: [{ md5: null }] }) // current hash
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }); // jobs today

    const result = await enqueueAnalysis(PROCUREMENT_ID, COMPANY_ID, USER_ID);

    expect(result).toEqual({
      ok: true,
      job: {
        id: 1,
        status: "running",
        error: null,
        created_at: jobRow().created_at,
      },
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("rejects when a done, non-stale analysis already exists", async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // no active job
      .mockResolvedValueOnce({ rows: [analysisRow({ document_set_hash: "abc" })] })
      .mockResolvedValueOnce({ rows: [{ md5: "abc" }] }) // same hash -> not stale
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const result = await enqueueAnalysis(PROCUREMENT_ID, COMPANY_ID, USER_ID);

    expect(result).toEqual({ error: "Esta licitação já foi analisada." });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("allows re-analysis when the document set hash changed (stale)", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [analysisRow({ document_set_hash: "old" })] })
      .mockResolvedValueOnce({ rows: [{ md5: "new" }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [jobRow({ id: "2" })] }); // insert

    const result = await enqueueAnalysis(PROCUREMENT_ID, COMPANY_ID, USER_ID);

    expect("ok" in result && result.ok).toBe(true);
    expect(query).toHaveBeenCalledTimes(5);
  });

  it("returns the cap error at or above ANALYZE_USER_DAILY_CAP", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ md5: null }] })
      .mockResolvedValueOnce({ rows: [{ count: ANALYZE_USER_DAILY_CAP }] });

    const result = await enqueueAnalysis(PROCUREMENT_ID, COMPANY_ID, USER_ID);

    expect(result).toEqual({
      error: `Limite diário de análises atingido (${ANALYZE_USER_DAILY_CAP}).`,
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("returns the closed-procurement error when the guarded insert matches no row", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ md5: null }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] }); // insert matched nothing

    const result = await enqueueAnalysis(PROCUREMENT_ID, COMPANY_ID, USER_ID);

    expect(result).toEqual({
      error: "Só licitações abertas podem ser analisadas.",
    });
  });

  it("inserts and returns the new job on the happy path", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ md5: null }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [jobRow({ id: "9" })] });

    const result = await enqueueAnalysis(PROCUREMENT_ID, COMPANY_ID, USER_ID);

    expect(result).toEqual({
      ok: true,
      job: {
        id: 9,
        status: "queued",
        error: null,
        created_at: jobRow().created_at,
      },
    });

    const [text, values] = query.mock.calls[4];
    expect(text).toContain("INSERT INTO analysis_jobs");
    expect(values).toEqual([PROCUREMENT_ID, COMPANY_ID, USER_ID]);
  });
});

describe("buildFetchAnalysis", () => {
  it("selects the dossier head row, never the raw data blob, bound on procurement_id", () => {
    const query = buildFetchAnalysis(PROCUREMENT_ID);
    expect(query.text).toContain("FROM tender_analyses");
    expect(query.text).toContain("WHERE procurement_id = $1");
    expect(query.text).not.toContain(" data");
    expect(query.text).not.toMatch(/\bdata\b/);
    expect(query.values).toEqual([PROCUREMENT_ID]);
  });
});

describe("buildFetchAnalysisFacts", () => {
  it("orders by id, bound on procurement_id", () => {
    const query = buildFetchAnalysisFacts(PROCUREMENT_ID);
    expect(query.text).toContain("FROM tender_analysis_facts");
    expect(query.text).toContain("WHERE procurement_id = $1");
    expect(query.text).toContain("ORDER BY id");
    expect(query.values).toEqual([PROCUREMENT_ID]);
  });
});

describe("buildFetchAnalysisDates", () => {
  it("orders by sequence, bound on procurement_id", () => {
    const query = buildFetchAnalysisDates(PROCUREMENT_ID);
    expect(query.text).toContain("FROM tender_analysis_dates");
    expect(query.text).toContain("WHERE procurement_id = $1");
    expect(query.text).toContain("ORDER BY sequence");
    expect(query.values).toEqual([PROCUREMENT_ID]);
  });
});

describe("buildFetchAnalysisRequirements", () => {
  it("orders by sequence, bound on procurement_id", () => {
    const query = buildFetchAnalysisRequirements(PROCUREMENT_ID);
    expect(query.text).toContain("FROM tender_analysis_requirements");
    expect(query.text).toContain("WHERE procurement_id = $1");
    expect(query.text).toContain("ORDER BY sequence");
    expect(query.values).toEqual([PROCUREMENT_ID]);
  });
});

describe("buildFetchAnalysisPenalties", () => {
  it("orders by sequence, bound on procurement_id", () => {
    const query = buildFetchAnalysisPenalties(PROCUREMENT_ID);
    expect(query.text).toContain("FROM tender_analysis_penalties");
    expect(query.text).toContain("WHERE procurement_id = $1");
    expect(query.text).toContain("ORDER BY sequence");
    expect(query.values).toEqual([PROCUREMENT_ID]);
  });
});

describe("buildFetchAnalysisRisks", () => {
  it("orders by sequence, bound on procurement_id", () => {
    const query = buildFetchAnalysisRisks(PROCUREMENT_ID);
    expect(query.text).toContain("FROM tender_analysis_risks");
    expect(query.text).toContain("WHERE procurement_id = $1");
    expect(query.text).toContain("ORDER BY sequence");
    expect(query.values).toEqual([PROCUREMENT_ID]);
  });
});

describe("buildFetchAnalysisMissing", () => {
  it("orders by sequence, bound on procurement_id", () => {
    const query = buildFetchAnalysisMissing(PROCUREMENT_ID);
    expect(query.text).toContain("FROM tender_analysis_missing");
    expect(query.text).toContain("WHERE procurement_id = $1");
    expect(query.text).toContain("ORDER BY sequence");
    expect(query.values).toEqual([PROCUREMENT_ID]);
  });
});

function analysisHeadRow(over: Record<string, unknown> = {}) {
  return {
    procurement_id: String(PROCUREMENT_ID),
    version: 1,
    status: "done",
    error: null,
    model: "gemini-3.7-flash",
    input_kind: "pdf",
    input_truncated: false,
    executive_summary: "Resumo.",
    object_text: "Objeto.",
    overall_risk: "medium",
    analyzed_at: new Date("2026-09-01T10:00:00Z"),
    ...over,
  };
}

// fetchAnalysis issues the head query first, then (only when it exists and is
// not an error) the six child queries together via Promise.all.
describe("fetchAnalysis", () => {
  it("returns null when there is no dossier row", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await fetchAnalysis(PROCUREMENT_ID);

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns null when the dossier status is 'error'", async () => {
    query.mockResolvedValueOnce({
      rows: [analysisHeadRow({ status: "error", error: "boom" })],
    });

    const result = await fetchAnalysis(PROCUREMENT_ID);

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("assembles the dossier from the head row plus six child queries", async () => {
    query
      .mockResolvedValueOnce({ rows: [analysisHeadRow()] })
      .mockResolvedValueOnce({ rows: [] }) // facts
      .mockResolvedValueOnce({ rows: [] }) // dates
      .mockResolvedValueOnce({ rows: [] }) // requirements
      .mockResolvedValueOnce({ rows: [] }) // penalties
      .mockResolvedValueOnce({ rows: [] }) // risks
      .mockResolvedValueOnce({ rows: [] }); // missing

    const result = await fetchAnalysis(PROCUREMENT_ID);

    expect(result).toEqual({
      procurement_id: PROCUREMENT_ID,
      version: 1,
      status: "done",
      error: null,
      model: "gemini-3.7-flash",
      input_kind: "pdf",
      input_truncated: false,
      executive_summary: "Resumo.",
      object_text: "Objeto.",
      overall_risk: "medium",
      analyzed_at: analysisHeadRow().analyzed_at,
      facts: [],
      dates: [],
      requirements: [],
      penalties: [],
      risks: [],
      missing: [],
    });
    expect(query).toHaveBeenCalledTimes(7);
  });
});
