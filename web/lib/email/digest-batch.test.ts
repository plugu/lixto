import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. Everything the batch talks to is mocked — no live database, and the
// digest computation itself is already covered by digest-queries.test.ts.
vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../digest-queries", () => ({ getDigest: vi.fn() }));
vi.mock("./outbox", () => ({ enqueue: vi.fn() }));
vi.mock("./unsubscribe", () => ({
  buildUnsubscribeUrl: vi.fn((email: string) => `https://lixto.com.br/email/unsubscribe?email=${email}`),
}));

import { pool } from "../db";
import { getDigest } from "../digest-queries";
import { enqueue } from "./outbox";
import { buildUnsubscribeUrl } from "./unsubscribe";
import { runDigestBatch } from "./digest-batch";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

type Recipient = { company_id: string | number; company_name: string; email: string };

function mockRecipients(rows: Recipient[]) {
  query.mockResolvedValue({ rows });
}

function digest(over: Record<string, unknown> = {}) {
  return {
    run: { started_at: new Date(), finished_at: new Date(), counters: {} },
    newCount: 0,
    matchedCount: 0,
    attentionCount: 0,
    attention: [],
    ...over,
  };
}

function attentionRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    company_id: 1,
    procurement_id: 10,
    source_id: "12345678000199-1-000001/2026",
    state: "matched",
    score: 80,
    reasons: [],
    attention: true,
    computed_at: new Date(),
    description: "Aquisição de lápis",
    agency_name: "Prefeitura",
    state_uf: "RJ",
    city_name: "Rio de Janeiro",
    modality_name: "Pregão",
    estimated_value: "1000.00",
    proposal_closes_at: new Date("2026-09-30T12:00:00Z"),
    verdict: null,
    rationale: null,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
  mock(getDigest).mockReset();
  mock(enqueue).mockReset();
  mock(buildUnsubscribeUrl).mockClear();
  mock(enqueue).mockResolvedValue({ id: 1 });
});

describe("runDigestBatch", () => {
  it("skips a company whose digest has zero attention and zero matches", async () => {
    mockRecipients([{ company_id: 1, company_name: "Alfa", email: "admin@alfa.com" }]);
    mock(getDigest).mockResolvedValue(digest());

    const result = await runDigestBatch();

    expect(result).toEqual({ companies: 1, enqueued: 0, skipped: 1 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues one dated, deduped row per admin email for a company with attention", async () => {
    mockRecipients([
      { company_id: 1, company_name: "Alfa", email: "admin1@alfa.com" },
      { company_id: 1, company_name: "Alfa", email: "admin2@alfa.com" },
    ]);
    mock(getDigest).mockResolvedValue(
      digest({ newCount: 10, matchedCount: 3, attentionCount: 1, attention: [attentionRow()] }),
    );

    const today = new Date().toISOString().slice(0, 10);
    const result = await runDigestBatch();

    expect(result).toEqual({ companies: 1, enqueued: 2, skipped: 0 });
    expect(enqueue).toHaveBeenCalledTimes(2);

    const calls = mock(enqueue).mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.toEmail)).toEqual(["admin1@alfa.com", "admin2@alfa.com"]);
    for (const call of calls) {
      expect(call.template).toBe("daily_digest");
      expect(call.companyId).toBe(1);
      expect(call.dedupeKey).toBe(`daily_digest:1:${today}`);
    }
  });

  it("maps at most the (already-capped) attention rows to the template's card shape", async () => {
    mockRecipients([{ company_id: 1, company_name: "Alfa", email: "admin@alfa.com" }]);
    // getDigest itself caps `attention` at ATTENTION_PREVIEW_LIMIT (5); the
    // batch trusts that and just maps whatever it gets.
    const rows = Array.from({ length: 5 }, (_, i) =>
      attentionRow({ source_id: `src-${i}`, score: 70 + i }),
    );
    mock(getDigest).mockResolvedValue(
      digest({ matchedCount: 8, attentionCount: 8, attention: rows }),
    );

    await runDigestBatch();

    const call = mock(enqueue).mock.calls[0][0];
    const attention = call.payload.attention as Array<Record<string, unknown>>;
    expect(attention.length).toBeLessThanOrEqual(5);
    expect(attention[0]).toEqual({
      sourceId: "src-0",
      description: "Aquisição de lápis",
      agency: "Prefeitura",
      state: "RJ",
      score: 70,
      closesAt: "2026-09-30T12:00:00.000Z",
      url: "https://lixto.com.br/procurement/src-0",
    });
  });

  it("builds the unsubscribe URL for each recipient's own address", async () => {
    mockRecipients([{ company_id: 1, company_name: "Alfa", email: "admin@alfa.com" }]);
    mock(getDigest).mockResolvedValue(digest({ matchedCount: 1, attentionCount: 0 }));

    await runDigestBatch();

    expect(buildUnsubscribeUrl).toHaveBeenCalledWith("admin@alfa.com");
    const call = mock(enqueue).mock.calls[0][0];
    expect(call.payload.unsubscribeUrl).toContain("admin@alfa.com");
  });

  it("passes companyId through to the recipient query", async () => {
    mockRecipients([]);

    await runDigestBatch({ companyId: 42 });

    expect(query).toHaveBeenCalledWith(expect.any(String), [42]);
  });

  it("counts multiple companies and mixes skipped with enqueued", async () => {
    mockRecipients([
      { company_id: 1, company_name: "Alfa", email: "a@alfa.com" },
      { company_id: 2, company_name: "Beta", email: "b@beta.com" },
    ]);
    mock(getDigest).mockImplementation(async (companyId: number) =>
      companyId === 1
        ? digest({ matchedCount: 2, attentionCount: 1, attention: [attentionRow()] })
        : digest(),
    );

    const result = await runDigestBatch();

    expect(result).toEqual({ companies: 2, enqueued: 1, skipped: 1 });
  });
});
