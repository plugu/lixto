import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a path
// alias. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { RESULTS_DELAY_DAYS } from "./case-outcome";
import type { CaseCheck } from "./case-verdict";
import {
  buildDecideCase,
  buildGetCase,
  buildListCaseChecks,
  buildListCases,
  buildListCasesForResultsRequest,
  buildListCasesToEmail,
  buildListGoOpportunitiesWithoutCase,
  buildSetOutcomeByOperator,
  fetchOutcomeEvidence,
  getCompanyAdminUserId,
  insertCase,
  insertSystemFeedback,
  listCasesAwaitingOutcome,
  listCasesForResultsRequest,
  listCasesToEmail,
  listCasesWaitingAnalysis,
  listCompanyAdminEmails,
  replaceCaseChecks,
  requestItemResults,
  setOutcomeByOperator,
  setOutcomeFromPncp,
  stampCaseEmailed,
  stampCaseResultsRequested,
} from "./case-queries";
import { pool } from "./db";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const connect = pool.connect as unknown as ReturnType<typeof vi.fn>;

const COMPANY_ID = 7;
const CASE_ID = 31;

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
});

function check(over: Partial<CaseCheck> = {}): CaseCheck {
  return {
    requirement_sequence: 1,
    category: "fiscal_labor",
    title: "Regularidade com o FGTS",
    mandatory: true,
    severity: "high",
    citations: [{ sequence: 1, page: 12 }],
    document_kind: "fgts_clearance",
    status: "met",
    document_id: 5,
    document_file_name: "crf.pdf",
    document_valid_until: new Date(2026, 11, 31),
    ...over,
  };
}

describe("tenant-scoped builders", () => {
  it("buildListCases binds company_id as $1 and orders open cases first", () => {
    const { text, values } = buildListCases(COMPANY_ID);

    expect(text).toContain("WHERE c.company_id = $1");
    expect(text).toContain("ORDER BY (c.status = 'decided'), c.session_at NULLS LAST, c.id DESC");
    expect(values).toEqual([COMPANY_ID]);
  });

  it("buildListCases counts every check status per case", () => {
    const { text } = buildListCases(COMPANY_ID);

    for (const status of ["met", "expiring", "missing", "manual"]) {
      expect(text).toContain(`k.status = '${status}') AS ${status}`);
    }
  });

  it("buildGetCase binds company_id then the case id", () => {
    const { text, values } = buildGetCase(COMPANY_ID, CASE_ID);

    expect(text).toContain("WHERE c.company_id = $1 AND c.id = $2");
    expect(values).toEqual([COMPANY_ID, CASE_ID]);
  });

  it("buildListCaseChecks scopes through the cases join", () => {
    const { text, values } = buildListCaseChecks(COMPANY_ID, CASE_ID);

    expect(text).toContain("JOIN cases c ON c.id = k.case_id");
    expect(text).toContain("WHERE c.company_id = $1 AND k.case_id = $2");
    expect(values).toEqual([COMPANY_ID, CASE_ID]);
  });

  it("buildDecideCase binds values in order and only decides a ready case", () => {
    const { text, values } = buildDecideCase(
      COMPANY_ID,
      CASE_ID,
      9,
      "missing_document",
      "Falta a CNDT",
    );

    expect(text).toContain(
      "WHERE id = $2 AND company_id = $1 AND status = 'ready'",
    );
    expect(text).toContain("RETURNING opportunity_id");
    expect(values).toEqual([COMPANY_ID, CASE_ID, 9, "missing_document", "Falta a CNDT"]);
  });

  it("buildSetOutcomeByOperator binds company_id and only touches a submitted case", () => {
    const { text, values } = buildSetOutcomeByOperator(COMPANY_ID, CASE_ID);

    expect(text).toContain(
      "WHERE id = $2 AND company_id = $1 AND decision = 'submit'",
    );
    expect(text).toContain("RETURNING opportunity_id");
    expect(values).toEqual([COMPANY_ID, CASE_ID]);
  });

  it("setOutcomeByOperator returns the opportunity id when a submitted case is disqualified", async () => {
    query.mockResolvedValueOnce({ rows: [{ opportunity_id: "4" }] });

    await expect(setOutcomeByOperator(COMPANY_ID, CASE_ID)).resolves.toEqual({
      opportunity_id: 4,
    });
  });

  it("setOutcomeByOperator returns null when nothing matched", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(setOutcomeByOperator(COMPANY_ID, CASE_ID)).resolves.toBeNull();
  });
});

describe("buildListGoOpportunitiesWithoutCase", () => {
  it("selects the newest go verdict and skips opportunities that already have a case", () => {
    const { text, values } = buildListGoOpportunitiesWithoutCase();

    expect(text).toContain("verdict = 'go'");
    expect(text).toContain("NOT EXISTS");
    expect(text).toContain("o.state <> 'dismissed'");
    expect(text).toContain("ORDER BY created_at DESC, id DESC LIMIT 1");
    expect(values).toEqual([null]);
  });

  it("binds the optional company filter as $1", () => {
    const { text, values } = buildListGoOpportunitiesWithoutCase(COMPANY_ID);

    expect(text).toContain("($1::bigint IS NULL OR o.company_id = $1)");
    expect(values).toEqual([COMPANY_ID]);
  });
});

describe("buildListCasesToEmail", () => {
  it("selects ready, unstamped cases and counts every check status", () => {
    const { text, values } = buildListCasesToEmail();

    expect(text).toContain("c.status = 'ready'");
    expect(text).toContain("c.email_enqueued_at IS NULL");
    expect(text).toContain(
      "COALESCE(NULLIF(co.trade_name, ''), co.legal_name) AS company_name",
    );
    for (const status of ["met", "expiring", "missing", "manual"]) {
      expect(text).toContain(`k.status = '${status}') AS ${status}`);
    }
    expect(values).toEqual([null]);
  });

  it("binds the optional company filter as $1", () => {
    const { text, values } = buildListCasesToEmail(COMPANY_ID);

    expect(text).toContain("($1::bigint IS NULL OR c.company_id = $1)");
    expect(values).toEqual([COMPANY_ID]);
  });
});

describe("results request queue", () => {
  it("buildListCasesForResultsRequest binds the delay in days and defaults to RESULTS_DELAY_DAYS", () => {
    const withDefault = buildListCasesForResultsRequest();

    expect(withDefault.text).toContain("decision = 'submit'");
    expect(withDefault.text).toContain("results_requested_at IS NULL");
    expect(withDefault.text).toContain("session_at IS NOT NULL");
    expect(withDefault.text).toContain(
      "session_at < now() - make_interval(days => $1)",
    );
    expect(withDefault.values).toEqual([RESULTS_DELAY_DAYS]);

    const { values } = buildListCasesForResultsRequest(5);
    expect(values).toEqual([5]);
  });

  it("listCasesForResultsRequest numbers the bigints", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "31", procurement_id: "9" }],
    });

    const rows = await listCasesForResultsRequest();

    expect(rows).toEqual([{ id: 31, procurement_id: 9 }]);
  });

  it("requestItemResults only opens the queue for never-requested, never-synced items", async () => {
    await requestItemResults(9);

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("WHERE procurement_id = $1");
    expect(text).toContain("results_requested_at IS NULL");
    expect(text).toContain("results_synced_at IS NULL");
    expect(values).toEqual([9]);
  });

  it("stampCaseResultsRequested stamps the case", async () => {
    await stampCaseResultsRequested(CASE_ID);

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("SET results_requested_at = now()");
    expect(text).toContain("WHERE id = $1");
    expect(values).toEqual([CASE_ID]);
  });
});

describe("outcome resolution", () => {
  it("listCasesAwaitingOutcome selects submitted, requested, unresolved cases", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "31", opportunity_id: "4" }],
    });

    const rows = await listCasesAwaitingOutcome();

    const [text] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("decision = 'submit'");
    expect(text).toContain("results_requested_at IS NOT NULL");
    expect(text).toContain("outcome IS NULL");
    expect(rows).toEqual([{ id: 31, opportunity_id: 4 }]);
  });

  it("fetchOutcomeEvidence compares digits-only tax ids and ignores cancelled results", async () => {
    query.mockResolvedValueOnce({
      rows: [{ won: true, unsynced_items: "0", result_rows: "1" }],
    });

    const evidence = await fetchOutcomeEvidence(CASE_ID);

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain(
      "regexp_replace(r.supplier_tax_id, '\\D', '', 'g') = c.tax_id",
    );
    expect(text).toContain("r.cancelled_at IS NULL");
    expect(values).toEqual([CASE_ID]);
    expect(evidence).toEqual({ won: true, unsyncedItems: 0, resultRows: 1 });
  });

  it("fetchOutcomeEvidence defaults to no evidence when the case matches no row", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(fetchOutcomeEvidence(CASE_ID)).resolves.toEqual({
      won: false,
      unsyncedItems: 0,
      resultRows: 0,
    });
  });

  it("setOutcomeFromPncp only resolves a case with no outcome yet", async () => {
    await setOutcomeFromPncp(CASE_ID, "won");

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("outcome_source = 'pncp'");
    expect(text).toContain("WHERE id = $1 AND outcome IS NULL");
    expect(values).toEqual([CASE_ID, "won"]);
  });

  it("insertSystemFeedback writes a feedback row with no acting user", async () => {
    await insertSystemFeedback(4, "won", "pncp:results");

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("VALUES ($1, NULL, $2, $3)");
    expect(values).toEqual([4, "won", "pncp:results"]);
  });
});

describe("batch helpers", () => {
  it("insertCase returns null when the opportunity already has a case", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const id = await insertCase({
      companyId: COMPANY_ID,
      procurementId: 3,
      opportunityId: 4,
      recommendationId: 5,
    });

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("ON CONFLICT (opportunity_id) DO NOTHING");
    expect(values).toEqual([COMPANY_ID, 3, 4, 5]);
    expect(id).toBeNull();
  });

  it("insertCase returns the new id as a number", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "88" }] });

    await expect(
      insertCase({
        companyId: COMPANY_ID,
        procurementId: 3,
        opportunityId: 4,
        recommendationId: null,
      }),
    ).resolves.toBe(88);
  });

  it("listCasesWaitingAnalysis numbers the bigints and takes an optional company", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "1", company_id: "7", procurement_id: "9" }],
    });

    const rows = await listCasesWaitingAnalysis(COMPANY_ID);

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("status = 'waiting_analysis'");
    expect(values).toEqual([COMPANY_ID]);
    expect(rows).toEqual([{ id: 1, company_id: 7, procurement_id: 9 }]);
  });

  it("getCompanyAdminUserId picks the company's lowest-id admin", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "4" }] });

    await expect(getCompanyAdminUserId(COMPANY_ID)).resolves.toBe(4);

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("role = 'admin'");
    expect(text).toContain("ORDER BY id LIMIT 1");
    expect(values).toEqual([COMPANY_ID]);
  });

  it("getCompanyAdminUserId returns null when the company has no admin", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getCompanyAdminUserId(COMPANY_ID)).resolves.toBeNull();
  });

  it("listCasesToEmail numbers the bigints for each row", async () => {
    const sessionAt = new Date("2026-10-01T15:00:00.000Z");
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "31",
          company_id: "7",
          company_name: "Acme Ltda",
          description: "Pregão eletrônico",
          agency_name: "Prefeitura de Exemplo",
          state_uf: "SP",
          session_at: sessionAt,
          met: "1",
          expiring: "0",
          missing: "2",
          manual: "1",
        },
      ],
    });

    const rows = await listCasesToEmail(COMPANY_ID);

    expect(rows).toEqual([
      {
        id: 31,
        company_id: 7,
        company_name: "Acme Ltda",
        description: "Pregão eletrônico",
        agency_name: "Prefeitura de Exemplo",
        state_uf: "SP",
        session_at: sessionAt,
        met: 1,
        expiring: 0,
        missing: 2,
        manual: 1,
      },
    ]);
  });

  it("listCompanyAdminEmails selects every admin's email for the company", async () => {
    query.mockResolvedValueOnce({
      rows: [{ email: "a@acme.com" }, { email: "b@acme.com" }],
    });

    const emails = await listCompanyAdminEmails(COMPANY_ID);

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("role = 'admin'");
    expect(values).toEqual([COMPANY_ID]);
    expect(emails).toEqual(["a@acme.com", "b@acme.com"]);
  });

  it("stampCaseEmailed sets email_enqueued_at on the case", async () => {
    await stampCaseEmailed(CASE_ID);

    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("SET email_enqueued_at = now()");
    expect(text).toContain("WHERE id = $1");
    expect(values).toEqual([CASE_ID]);
  });
});

describe("replaceCaseChecks", () => {
  function stubClient(order: string[]) {
    return {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
          order.push(text);
        } else if (text.includes("DELETE FROM case_checks")) {
          order.push("DELETE");
        } else if (text.includes("INSERT INTO case_checks")) {
          order.push("INSERT");
          order.push(JSON.stringify(values));
        } else if (text.includes("UPDATE cases")) {
          order.push("UPDATE");
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
  }

  it("deletes, inserts and flips the case to ready inside one transaction", async () => {
    const order: string[] = [];
    const client = stubClient(order);
    connect.mockResolvedValue(client);
    const sessionAt = new Date("2026-10-01T15:00:00.000Z");

    await replaceCaseChecks(CASE_ID, [check(), check({ requirement_sequence: 2 })], {
      analysisVersion: 3,
      sessionAt,
      sessionSource: "dossier_session",
    });

    expect(order.filter((step) => !step.startsWith("["))).toEqual([
      "BEGIN",
      "DELETE",
      "INSERT",
      "UPDATE",
      "COMMIT",
    ]);
    // 12 bound values per check line, both lines in one statement.
    const insertValues = JSON.parse(
      order.find((step) => step.startsWith("[")) as string,
    ) as unknown[];
    expect(insertValues).toHaveLength(24);
    // The DATE column is bound as a calendar day, not an instant.
    expect(insertValues[11]).toBe("2026-12-31");

    const update = client.query.mock.calls.find(([text]) =>
      String(text).includes("UPDATE cases"),
    ) as [string, unknown[]];
    expect(update[1]).toEqual([CASE_ID, 3, sessionAt, "dossier_session"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("skips the insert when the dossier has no requirements", async () => {
    const order: string[] = [];
    const client = stubClient(order);
    connect.mockResolvedValue(client);

    await replaceCaseChecks(CASE_ID, [], {
      analysisVersion: 1,
      sessionAt: null,
      sessionSource: null,
    });

    expect(order).toEqual(["BEGIN", "DELETE", "UPDATE", "COMMIT"]);
  });

  it("rolls back and rethrows when a statement fails", async () => {
    const order: string[] = [];
    const client = stubClient(order);
    client.query.mockImplementationOnce(async () => {
      order.push("BEGIN");
      return { rows: [] };
    });
    client.query.mockImplementationOnce(async () => {
      throw new Error("deadlock");
    });
    connect.mockResolvedValue(client);

    await expect(
      replaceCaseChecks(CASE_ID, [check()], {
        analysisVersion: 1,
        sessionAt: null,
        sessionSource: null,
      }),
    ).rejects.toThrow("deadlock");

    expect(order).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
