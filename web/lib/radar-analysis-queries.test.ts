import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import {
  countAnalysesToday,
  getAnalysis,
  insertAnalysis,
} from "./radar-analysis-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const CONTENT = {
  why_it_may_happen: "Sinal detectado no PCA.",
  company_fit: "Provável aderência ao perfil.",
  preparation: ["Reunir documentação"],
};

beforeEach(() => {
  query.mockReset();
});

describe("getAnalysis", () => {
  it("binds company_id and future_opportunity_id and returns the row", async () => {
    query.mockResolvedValueOnce({
      rows: [{ content: CONTENT, model: "gemini-3.7-flash", created_at: new Date("2026-09-01") }],
    });

    const row = await getAnalysis(1, 171);

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("company_id = $1 AND future_opportunity_id = $2");
    expect(values).toEqual([1, 171]);
    expect(row?.content).toEqual(CONTENT);
  });

  it("is null when there is no cached analysis", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getAnalysis(1, 171)).toBe(null);
  });
});

describe("insertAnalysis", () => {
  it("inserts with ON CONFLICT DO NOTHING, then re-reads the row", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // the INSERT
    query.mockResolvedValueOnce({
      rows: [{ content: CONTENT, model: "gemini-3.7-flash", created_at: new Date("2026-09-01") }],
    }); // the re-read

    const row = await insertAnalysis(1, 171, "gemini-3.7-flash", CONTENT);

    const [insertText, insertValues] = query.mock.calls[0];
    expect(insertText).toContain("INSERT INTO future_opportunity_analyses");
    expect(insertText).toContain("ON CONFLICT (company_id, future_opportunity_id) DO NOTHING");
    expect(insertValues).toEqual([1, 171, "gemini-3.7-flash", JSON.stringify(CONTENT)]);
    expect(row.content).toEqual(CONTENT);
  });

  it("throws if the re-read somehow finds nothing", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });

    await expect(insertAnalysis(1, 171, "gemini-3.7-flash", CONTENT)).rejects.toThrow();
  });
});

describe("countAnalysesToday", () => {
  it("binds only companyId and uses the São Paulo day boundary", async () => {
    query.mockResolvedValueOnce({ rows: [{ count: "3" }] });

    const count = await countAnalysesToday(1);

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("company_id = $1");
    expect(text).toContain("date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')");
    expect(values).toEqual([1]);
    expect(count).toBe(3);
  });

  it("returns 0 when there are no rows today", async () => {
    query.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    expect(await countAnalysesToday(1)).toBe(0);
  });
});
