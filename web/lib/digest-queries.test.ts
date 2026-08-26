import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. `opportunity-queries` is mocked — these tests never touch a live
// database.
vi.mock("./opportunity-queries", async () => {
  const actual = await vi.importActual<
    typeof import("./opportunity-queries")
  >("./opportunity-queries");
  return {
    ATTENTION_SCORE: actual.ATTENTION_SCORE,
    getLastRun: vi.fn(),
    listOpportunities: vi.fn(),
  };
});

import { getLastRun, listOpportunities } from "./opportunity-queries";
import { getDigest } from "./digest-queries";

const mockGetLastRun = getLastRun as unknown as ReturnType<typeof vi.fn>;
const mockListOpportunities = listOpportunities as unknown as ReturnType<
  typeof vi.fn
>;

function opportunity(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    company_id: 1,
    procurement_id: 10,
    source_id: "12345678000199-1-000001/2026",
    state: "matched",
    score: 55,
    reasons: [],
    attention: false,
    computed_at: new Date("2026-08-25T10:00:00Z"),
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
  mockGetLastRun.mockReset();
  mockListOpportunities.mockReset();
});

describe("getDigest", () => {
  it("returns zeros and no run when the batch never ran", async () => {
    mockGetLastRun.mockResolvedValue(null);

    const digest = await getDigest(1);

    expect(digest).toEqual({
      run: null,
      newCount: 0,
      matchedCount: 0,
      attentionCount: 0,
      attention: [],
    });
    expect(mockListOpportunities).not.toHaveBeenCalled();
  });

  it("reads newCount from the run's scored counter", async () => {
    const startedAt = new Date("2026-08-25T08:00:00Z");
    mockGetLastRun.mockResolvedValue({
      id: 1,
      started_at: startedAt,
      finished_at: new Date("2026-08-25T08:05:00Z"),
      counters: { scored: 137, matched: 23, attention: 5 },
      status: "done",
    });
    mockListOpportunities.mockResolvedValue([]);

    const digest = await getDigest(1);

    expect(digest.newCount).toBe(137);
    expect(digest.run).toEqual({
      started_at: startedAt,
      finished_at: new Date("2026-08-25T08:05:00Z"),
      counters: { scored: 137, matched: 23, attention: 5 },
    });
  });

  it("counts matched/attention from the uncapped call and previews from the capped one", async () => {
    const startedAt = new Date("2026-08-25T08:00:00Z");
    mockGetLastRun.mockResolvedValue({
      id: 1,
      started_at: startedAt,
      finished_at: null,
      counters: { scored: 10 },
      status: "done",
    });

    const uncapped = [
      opportunity({ id: 1, score: 90, attention: true }),
      opportunity({ id: 2, score: 80, attention: true }),
      opportunity({ id: 3, score: 55, attention: false }),
    ];
    const preview = uncapped.filter((o) => o.attention);
    mockListOpportunities
      .mockResolvedValueOnce(uncapped)
      .mockResolvedValueOnce(preview);

    const digest = await getDigest(1);

    expect(digest.matchedCount).toBe(3);
    expect(digest.attentionCount).toBe(2);
    expect(digest.attention).toBe(preview);

    expect(mockListOpportunities).toHaveBeenCalledTimes(2);
    expect(mockListOpportunities).toHaveBeenNthCalledWith(1, 1, {
      states: ["matched", "recommended"],
      sinceRunAt: startedAt,
      limit: 1000,
    });
    expect(mockListOpportunities).toHaveBeenNthCalledWith(2, 1, {
      states: ["matched", "recommended"],
      minScore: 70,
      sinceRunAt: startedAt,
      limit: 5,
    });
  });

  it("defaults newCount to 0 when the run has no scored counter", async () => {
    mockGetLastRun.mockResolvedValue({
      id: 1,
      started_at: new Date(),
      finished_at: null,
      counters: {},
      status: "running",
    });
    mockListOpportunities.mockResolvedValue([]);

    const digest = await getDigest(1);
    expect(digest.newCount).toBe(0);
  });
});
