import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. Everything the batch talks to is mocked — no live database, and the
// scoring itself is already covered by match-engine/match-queries tests.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./match-queries", () => ({ fetchMatches: vi.fn() }));
vi.mock("./opportunity-queries", async () => {
  const actual = await vi.importActual<
    typeof import("./opportunity-queries")
  >("./opportunity-queries");
  return {
    ATTENTION_SCORE: actual.ATTENTION_SCORE,
    MATCH_SCORE: actual.MATCH_SCORE,
    getLastRun: vi.fn(),
    insertMatch: vi.fn(),
    upsertOpportunity: vi.fn(),
    setOpportunityState: vi.fn(),
  };
});

import { pool } from "./db";
import { fetchMatches } from "./match-queries";
import {
  getLastRun,
  insertMatch,
  setOpportunityState,
  upsertOpportunity,
} from "./opportunity-queries";
import { runMatchBatch } from "./match-batch";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const mock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

type Row = { source_id: string; score: number };

function matchRow(source_id: string, score: number) {
  return {
    source_id,
    description: null,
    agency_name: null,
    city_name: null,
    state: "RJ",
    modality_name: null,
    estimated_value: "1000.00",
    proposal_opens_at: null,
    proposal_closes_at: null,
    summary: null,
    risks: null,
    complexity: null,
    enriched: true,
    score,
    reasons: [{ code: "term_enrichment", weight: 25, detail: "lapis" }],
  };
}

/** The pool answers, in order: the company list, then one procurement-id
 * lookup per company that has rows to persist, then the run open/close. The
 * INSERT/UPDATE on agent_runs are matched by SQL text so ordering the rest
 * stays readable. */
function mockPool(companyIds: number[], ids: Record<string, number>) {
  query.mockImplementation(async (text: string) => {
    if (text.includes("INSERT INTO agent_runs")) return { rows: [{ id: "42" }] };
    if (text.includes("UPDATE agent_runs")) return { rows: [] };
    if (text.includes("FROM companies")) {
      return { rows: companyIds.map((id) => ({ id: String(id) })) };
    }
    if (text.includes("FROM procurements")) {
      return {
        rows: Object.entries(ids).map(([source_id, id]) => ({
          id: String(id),
          source_id,
        })),
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });
}

/** The single pool call whose SQL contains `fragment`, as [text, values]. */
function callWith(fragment: string): [string, unknown[]] {
  const call = query.mock.calls.find((c) => String(c[0]).includes(fragment));
  if (!call) throw new Error(`no query containing ${fragment}`);
  return [String(call[0]), (call[1] ?? []) as unknown[]];
}

function rowsPerCompany(byCompany: Record<number, Row[]>) {
  mock(fetchMatches).mockImplementation(async (companyId: number) =>
    (byCompany[companyId] ?? []).map((r) => matchRow(r.source_id, r.score)),
  );
}

beforeEach(() => {
  query.mockReset();
  mock(fetchMatches).mockReset();
  mock(getLastRun).mockReset();
  mock(insertMatch).mockReset();
  mock(upsertOpportunity).mockReset();
  mock(setOpportunityState).mockReset();
  mock(getLastRun).mockResolvedValue(null);
  mock(upsertOpportunity).mockResolvedValue({ id: 1, created: true });
});

describe("runMatchBatch", () => {
  it("scores from the epoch when no run ever finished", async () => {
    mockPool([1], {});
    rowsPerCompany({ 1: [] });

    await runMatchBatch();

    const [, filters, limit, candidateLimit] = mock(fetchMatches).mock.calls[0];
    expect(filters.statuses).toEqual(["open", "upcoming"]);
    expect((filters.signalsSince as Date).getTime()).toBe(0);
    expect(limit).toBe(1000);
    expect(candidateLimit).toBe(500);
  });

  it("defaults `since` to the started_at of the last done run", async () => {
    const startedAt = new Date("2026-08-24T03:00:00Z");
    mock(getLastRun).mockResolvedValue({
      id: 7,
      started_at: startedAt,
      finished_at: new Date("2026-08-24T03:02:00Z"),
      counters: {},
      status: "done",
    });
    mockPool([1], {});
    rowsPerCompany({ 1: [] });

    await runMatchBatch();

    expect(getLastRun).toHaveBeenCalledWith("match");
    const [, filters] = mock(fetchMatches).mock.calls[0];
    expect(filters.signalsSince).toBe(startedAt);
  });

  it("rescans from the epoch when the last run failed", async () => {
    mock(getLastRun).mockResolvedValue({
      id: 7,
      started_at: new Date("2026-08-24T03:00:00Z"),
      finished_at: null,
      counters: {},
      status: "failed",
    });
    mockPool([1], {});
    rowsPerCompany({ 1: [] });

    await runMatchBatch();

    const [, filters] = mock(fetchMatches).mock.calls[0];
    expect((filters.signalsSince as Date).getTime()).toBe(0);
  });

  it("an explicit `since` wins over the watermark", async () => {
    const since = new Date("2026-01-01T00:00:00Z");
    mockPool([1], {});
    rowsPerCompany({ 1: [] });

    await runMatchBatch({ since });

    expect(mock(fetchMatches).mock.calls[0][1].signalsSince).toBe(since);
  });

  it("persists only rows at or above the match threshold", async () => {
    mockPool([1], { a: 100, b: 200, c: 300 });
    rowsPerCompany({ 1: [
      { source_id: "a", score: 39 },
      { source_id: "b", score: 40 },
      { source_id: "c", score: 85 },
    ] });

    const out = await runMatchBatch();

    expect(out).toEqual({
      runId: 42,
      companies: 1,
      scored: 3,
      matched: 2,
      attention: 1,
    });
    expect(mock(insertMatch).mock.calls.map((c) => c[1])).toEqual([200, 300]);
    // company, procurement, score, reasons, engine version
    expect(mock(insertMatch).mock.calls[0][0]).toBe(1);
    expect(mock(insertMatch).mock.calls[0][2]).toBe(40);
    expect(mock(insertMatch).mock.calls[0][4]).toBe("2");
  });

  it("moves created opportunities to `matched` and leaves existing ones alone", async () => {
    mockPool([1], { a: 100, b: 200 });
    rowsPerCompany({ 1: [
      { source_id: "a", score: 50 },
      { source_id: "b", score: 60 },
    ] });
    mock(upsertOpportunity)
      .mockResolvedValueOnce({ id: 11, created: true })
      .mockResolvedValueOnce({ id: 12, created: false });

    await runMatchBatch();

    expect(setOpportunityState).toHaveBeenCalledTimes(1);
    expect(setOpportunityState).toHaveBeenCalledWith(1, 11, "matched");
  });

  it("skips a source_id that no longer resolves to a procurement", async () => {
    mockPool([1], { a: 100 });
    rowsPerCompany({ 1: [
      { source_id: "a", score: 50 },
      { source_id: "gone", score: 90 },
    ] });

    const out = await runMatchBatch();

    expect(out.scored).toBe(2);
    expect(out.matched).toBe(1);
    expect(out.attention).toBe(0);
  });

  it("keeps going when one company fails, and counts it", async () => {
    mockPool([1, 2, 3], { a: 100 });
    mock(fetchMatches).mockImplementation(async (companyId: number) => {
      if (companyId === 2) throw new Error("boom");
      return [matchRow("a", 90)];
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await runMatchBatch();

    expect(out.companies).toBe(3);
    expect(out.matched).toBe(2);
    expect(out.attention).toBe(2);

    const [, close] = callWith("UPDATE agent_runs");
    expect(close[1]).toBe("done");
    expect(JSON.parse(String(close[2]))).toEqual({
      companies: 3,
      scored: 2,
      matched: 2,
      attention: 2,
      failed: 1,
    });
  });

  it("opens the run as running, global company_id, and closes it done", async () => {
    mockPool([1], {});
    rowsPerCompany({ 1: [] });

    await runMatchBatch();

    const [openText, openValues] = callWith("INSERT INTO agent_runs");
    expect(openText).toContain("'match'");
    expect(openText).toContain("'running'");
    expect(openValues).toEqual([null]);

    const [, close] = callWith("UPDATE agent_runs");
    expect(close[0]).toBe(42);
    expect(close[1]).toBe("done");
  });

  it("scopes a single-company run and stamps the run with that company", async () => {
    mockPool([1, 2], { a: 100 });
    rowsPerCompany({ 2: [{ source_id: "a", score: 90 }] });

    const out = await runMatchBatch({ companyId: 2, candidateLimit: 10 });

    expect(out.companies).toBe(1);
    expect(mock(fetchMatches).mock.calls).toHaveLength(1);
    expect(mock(fetchMatches).mock.calls[0][0]).toBe(2);
    expect(mock(fetchMatches).mock.calls[0][3]).toBe(10);

    const [, openValues] = callWith("INSERT INTO agent_runs");
    expect(openValues).toEqual([2]);
  });

  it("marks the run failed and rethrows on an unexpected error", async () => {
    query.mockImplementation(async (text: string) => {
      if (text.includes("INSERT INTO agent_runs")) return { rows: [{ id: "42" }] };
      if (text.includes("UPDATE agent_runs")) return { rows: [] };
      throw new Error("db is down");
    });

    await expect(runMatchBatch()).rejects.toThrow("db is down");

    const [, close] = callWith("UPDATE agent_runs");
    expect(close[1]).toBe("failed");
    expect(close[3]).toBe("db is down");
  });
});
