import { describe, expect, it } from "vitest";

import type { ProfileSummary, ReasonCode } from "./match-engine";
import {
  DEFAULT_WEIGHTS,
  RADAR_ENGINE_VERSION,
  RADAR_MATCH_MIN,
  loadWeights,
  scoreCompanyMatch,
  scoreOpportunity,
  type RadarCandidateFacts,
  type SignalCode,
} from "./radar-engine";

const NOW = new Date("2026-09-07T12:00:00Z");

/** `n` days from NOW as a plain ISO date. */
function inDays(n: number): string {
  const d = new Date(NOW.getTime() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function codes(signals: { code: SignalCode }[]): SignalCode[] {
  return signals.map((s) => s.code);
}

describe("scoreOpportunity", () => {
  it("always emits pca_item, even with nothing else known", () => {
    const { score, signals } = scoreOpportunity(
      { expected_date: null, plan_updated_at: null },
      NOW,
    );
    expect(codes(signals)).toEqual(["pca_item", "date_far"]);
    expect(score).toBe(DEFAULT_WEIGHTS.pcaItem);
    expect(signals[0].weight).toBe(50);
    expect(signals[1].weight).toBe(0);
  });

  it("scores the near band for 0..90 days", () => {
    for (const days of [0, 1, 45, 90]) {
      const { score, signals } = scoreOpportunity(
        { expected_date: inDays(days), plan_updated_at: null },
        NOW,
      );
      expect(codes(signals)).toEqual(["pca_item", "date_near"]);
      expect(score).toBe(80);
    }
  });

  it("scores the mid band for 91..180 days", () => {
    for (const days of [91, 120, 180]) {
      const { score, signals } = scoreOpportunity(
        { expected_date: inDays(days), plan_updated_at: null },
        NOW,
      );
      expect(codes(signals)).toEqual(["pca_item", "date_mid"]);
      expect(score).toBe(65);
    }
  });

  it("emits a zero-weight date_far beyond 180 days and in the past", () => {
    for (const days of [181, 400, -1, -90]) {
      const { score, signals } = scoreOpportunity(
        { expected_date: inDays(days), plan_updated_at: null },
        NOW,
      );
      expect(codes(signals)).toEqual(["pca_item", "date_far"]);
      expect(signals[1].weight).toBe(0);
      expect(signals[1].detail).not.toBe("");
      expect(score).toBe(50);
    }
  });

  it("adds recent_plan_update when the plan was touched within 60 days", () => {
    const { score, signals } = scoreOpportunity(
      { expected_date: inDays(10), plan_updated_at: inDays(-30) },
      NOW,
    );
    expect(codes(signals)).toEqual([
      "pca_item",
      "date_near",
      "recent_plan_update",
    ]);
    expect(score).toBe(100);
  });

  it("ignores a plan update older than 60 days or in the future", () => {
    for (const updated of [inDays(-61), inDays(-400), inDays(5)]) {
      const { signals } = scoreOpportunity(
        { expected_date: null, plan_updated_at: updated },
        NOW,
      );
      expect(codes(signals)).not.toContain("recent_plan_update");
    }
  });

  it("clamps to 0..100 with oversized weights", () => {
    const { score } = scoreOpportunity(
      { expected_date: inDays(1), plan_updated_at: inDays(-1) },
      NOW,
      { pcaItem: 90, dateNear: 90, dateMid: 90, recentUpdate: 90 },
    );
    expect(score).toBe(100);
  });

  it("respects custom weights", () => {
    const { score } = scoreOpportunity(
      { expected_date: inDays(100), plan_updated_at: null },
      NOW,
      { pcaItem: 10, dateNear: 5, dateMid: 7, recentUpdate: 3 },
    );
    expect(score).toBe(17);
  });

  it("treats an unparsable date as unknown, never as a crash", () => {
    const { score, signals } = scoreOpportunity(
      { expected_date: "not-a-date", plan_updated_at: "nope" },
      NOW,
    );
    expect(codes(signals)).toEqual(["pca_item", "date_far"]);
    expect(score).toBe(50);
  });

  it("never claims a purchase is confirmed", () => {
    const { signals } = scoreOpportunity(
      { expected_date: inDays(10), plan_updated_at: inDays(-3) },
      NOW,
    );
    const details = signals.map((s) => s.detail).join(" ").toLowerCase();
    expect(details).not.toContain("confirmad");
    expect(details).toContain("previsto");
    expect(details).toContain("estimada");
  });
});

describe("loadWeights", () => {
  it("falls back to the defaults on an empty env", () => {
    expect(loadWeights({})).toEqual(DEFAULT_WEIGHTS);
  });

  it("reads every LIXTO_RADAR_WEIGHT_* var", () => {
    expect(
      loadWeights({
        LIXTO_RADAR_WEIGHT_PCA_ITEM: "40",
        LIXTO_RADAR_WEIGHT_DATE_NEAR: "25",
        LIXTO_RADAR_WEIGHT_DATE_MID: "12",
        LIXTO_RADAR_WEIGHT_RECENT_UPDATE: "8",
      }),
    ).toEqual({ pcaItem: 40, dateNear: 25, dateMid: 12, recentUpdate: 8 });
  });

  it("falls back per-var on junk, blanks and negatives", () => {
    expect(
      loadWeights({
        LIXTO_RADAR_WEIGHT_PCA_ITEM: "abc",
        LIXTO_RADAR_WEIGHT_DATE_NEAR: "  ",
        LIXTO_RADAR_WEIGHT_DATE_MID: "-3",
        LIXTO_RADAR_WEIGHT_RECENT_UPDATE: "8",
      }),
    ).toEqual({ ...DEFAULT_WEIGHTS, recentUpdate: 8 });
  });

  it("accepts 0 as an operator disabling a signal", () => {
    expect(loadWeights({ LIXTO_RADAR_WEIGHT_DATE_MID: "0" }).dateMid).toBe(0);
  });
});

describe("RADAR_ENGINE_VERSION", () => {
  it("is the string stamped on every row", () => {
    expect(RADAR_ENGINE_VERSION).toBe("1");
  });
});

function facts(over: Partial<RadarCandidateFacts> = {}): RadarCandidateFacts {
  return {
    id: 1,
    state: null,
    estimated_value: null,
    text_hit: false,
    exclusion_hit: false,
    similarity: null,
    ...over,
  };
}

function profile(over: Partial<ProfileSummary> = {}): ProfileSummary & {
  exclusion_terms: string[];
} {
  return {
    terms: ["lapis"],
    exclusion_terms: [],
    states: [],
    min_value: null,
    max_value: null,
    size: "ME",
    ...over,
  };
}

function matchCodes(reasons: { code: ReasonCode }[]): ReasonCode[] {
  return reasons.map((r) => r.code);
}

describe("scoreCompanyMatch", () => {
  it("emits no_profile with score 0 when there are no terms and no similarity", () => {
    const { score, reasons } = scoreCompanyMatch(
      facts(),
      profile({ terms: [] }),
    );
    expect(score).toBe(0);
    expect(matchCodes(reasons)).toEqual(["no_profile"]);
  });

  it("scores term_text at +40", () => {
    const { score, reasons } = scoreCompanyMatch(facts({ text_hit: true }), profile());
    // estimated_value is null in the fixture, so value_unknown (weight 0) always tags along.
    expect(matchCodes(reasons)).toEqual(["term_text", "value_unknown"]);
    expect(score).toBe(40);
  });

  it("scores semantic_high (>=0.55) higher than semantic (>=0.40)", () => {
    const high = scoreCompanyMatch(facts({ similarity: 0.6 }), profile());
    expect(matchCodes(high.reasons)).toEqual(["semantic_high", "value_unknown"]);
    expect(high.score).toBe(35);

    const mid = scoreCompanyMatch(facts({ similarity: 0.45 }), profile());
    expect(matchCodes(mid.reasons)).toEqual(["semantic", "value_unknown"]);
    expect(mid.score).toBe(20);

    const low = scoreCompanyMatch(facts({ similarity: 0.1 }), profile());
    expect(matchCodes(low.reasons)).toEqual(["value_unknown"]);
    expect(low.score).toBe(0);
  });

  it("scores state_ok when profile states is empty or contains the item state", () => {
    const anyState = scoreCompanyMatch(
      facts({ state: "RJ", text_hit: true }),
      profile({ states: [] }),
    );
    expect(matchCodes(anyState.reasons)).toEqual([
      "term_text",
      "state_ok",
      "value_unknown",
    ]);

    const matching = scoreCompanyMatch(
      facts({ state: "RJ", text_hit: true }),
      profile({ states: ["RJ", "SP"] }),
    );
    expect(matchCodes(matching.reasons)).toEqual([
      "term_text",
      "state_ok",
      "value_unknown",
    ]);
    expect(matching.score).toBe(55);
  });

  it("scores state_out (-30) when the item state is known but not in the profile", () => {
    const { score, reasons } = scoreCompanyMatch(
      facts({ state: "RJ", text_hit: true }),
      profile({ states: ["SP"] }),
    );
    expect(matchCodes(reasons)).toEqual(["term_text", "state_out", "value_unknown"]);
    expect(score).toBe(10);
  });

  it("emits no state reason when the item state is unknown", () => {
    const { reasons } = scoreCompanyMatch(
      facts({ state: null, text_hit: true }),
      profile({ states: ["SP"] }),
    );
    expect(matchCodes(reasons)).toEqual(["term_text", "value_unknown"]);
  });

  it("scores value_ok inside the band and value_out outside it", () => {
    const inside = scoreCompanyMatch(
      facts({ text_hit: true, estimated_value: "5000.00" }),
      profile({ min_value: "1000.00", max_value: "10000.00" }),
    );
    expect(matchCodes(inside.reasons)).toEqual(["term_text", "value_ok"]);

    const outside = scoreCompanyMatch(
      facts({ text_hit: true, estimated_value: "50000.00" }),
      profile({ min_value: "1000.00", max_value: "10000.00" }),
    );
    expect(matchCodes(outside.reasons)).toEqual(["term_text", "value_out"]);
    expect(outside.score).toBe(20);
  });

  it("emits value_unknown at weight 0 when the estimated value is absent", () => {
    const { score, reasons } = scoreCompanyMatch(
      facts({ text_hit: true, estimated_value: null }),
      profile(),
    );
    expect(matchCodes(reasons)).toEqual(["term_text", "value_unknown"]);
    expect(reasons[1].weight).toBe(0);
    expect(score).toBe(40);
  });

  it("scores exclusion at -60", () => {
    const { score, reasons } = scoreCompanyMatch(
      facts({ text_hit: true, exclusion_hit: true }),
      profile(),
    );
    expect(matchCodes(reasons)).toEqual(["term_text", "value_unknown", "exclusion"]);
    expect(score).toBe(0); // clamped: 40 + 0 - 60 = -20 -> 0
  });

  it("clamps the total to 0..100", () => {
    const { score } = scoreCompanyMatch(
      facts({ text_hit: true, similarity: 0.9, state: "RJ", estimated_value: "1.00" }),
      profile({ states: [], min_value: null, max_value: null }),
    );
    expect(score).toBe(100); // 40 + 35 + 15 + 10 = 100
  });
});

describe("RADAR_MATCH_MIN", () => {
  it("is the persistence floor", () => {
    expect(RADAR_MATCH_MIN).toBe(40);
  });
});
