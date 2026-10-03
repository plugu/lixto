import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ pool: { query } }));

import { fetchClassification } from "./classification-queries";

describe("fetchClassification", () => {
  beforeEach(() => query.mockReset());

  it("returns null when the procurement has no done classification", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await fetchClassification(7)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("classification_segments");
    expect(query.mock.calls[0][1]).toEqual([7]);
  });

  it("joins segments and cnae_codes and merges the cnaes", async () => {
    const row = {
      segment: "informatica",
      segment_label: "Informática e telecom",
      segment_confidence: 0.9,
      nature: "bens",
      keywords: ["notebook"],
      classified_at: new Date("2026-10-01T00:00:00Z"),
    };
    const cnae = {
      code: "4751201",
      description: "Comércio varejista de informática",
      confidence: 0.8,
      origin: "ingest",
    };
    query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [cnae] });

    const result = await fetchClassification(7);

    expect(result).toEqual({ ...row, cnaes: [cnae] });
    const cnaeSql = query.mock.calls[1][0] as string;
    expect(cnaeSql).toContain("LEFT JOIN cnae_codes");
    expect(cnaeSql).toContain("(pc.origin = 'enrichment') DESC");
    expect(query.mock.calls[1][1]).toEqual([7]);
  });
});
