import { describe, expect, it } from "vitest";

import {
  scoreCandidate,
  type CandidateFacts,
  type ProfileSummary,
  type ReasonCode,
} from "./match-engine";

function facts(over: Partial<CandidateFacts> = {}): CandidateFacts {
  return {
    source_id: "12345678000199-1-000123/2026",
    state: "RJ",
    estimated_value: "184000.00",
    cnae_hits_primary: [],
    cnae_hits_secondary: [],
    term_hits: [],
    text_hit: false,
    exclusion_hit: false,
    me_epp_exclusive: null,
    requires_certification: null,
    requires_technical_certificate: null,
    similarity: null,
    ...over,
  };
}

function profile(over: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    terms: ["lapis"],
    states: [],
    min_value: null,
    max_value: null,
    size: "ME",
    ...over,
  };
}

function codes(reasons: { code: ReasonCode }[]): ReasonCode[] {
  return reasons.map((r) => r.code);
}

function weight(
  reasons: { code: ReasonCode; weight: number }[],
  code: ReasonCode,
): number | undefined {
  return reasons.find((r) => r.code === code)?.weight;
}

describe("scoreCandidate — no_profile", () => {
  it("returns a single weight-0 reason and score 0 with no terms and no CNAE hit", () => {
    const out = scoreCandidate(facts(), profile({ terms: [] }));
    expect(out.score).toBe(0);
    expect(out.reasons).toEqual([
      {
        code: "no_profile",
        weight: 0,
        detail: "Sem termos e sem CNAE em comum",
      },
    ]);
  });

  it("still scores with no terms when a CNAE matches", () => {
    const out = scoreCandidate(
      facts({ cnae_hits_primary: ["4761003"] }),
      profile({ terms: [] }),
    );
    // 35 (cnae) + 10 (state, profile has no states) + 10 (value, no bounds)
    expect(out.score).toBe(55);
    expect(codes(out.reasons)).toEqual(["cnae_primary", "state_ok", "value_ok"]);
  });

  it("still scores with no terms and no CNAE when there is a similarity", () => {
    const out = scoreCandidate(facts({ similarity: 0.61 }), profile({ terms: [] }));
    expect(codes(out.reasons)).not.toContain("no_profile");
    // 10 (state free) + 10 (value free) + 20 (semantic_high)
    expect(out.score).toBe(40);
  });

  it("still returns no_profile when similarity is null", () => {
    const out = scoreCandidate(facts({ similarity: null }), profile({ terms: [] }));
    expect(codes(out.reasons)).toEqual(["no_profile"]);
  });
});

describe("scoreCandidate — semantic", () => {
  it("gives +20 semantic_high from 0.55 up, with sim= as detail", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], similarity: 0.61 }),
      profile(),
    );
    expect(weight(out.reasons, "semantic_high")).toBe(20);
    expect(out.reasons.find((r) => r.code === "semantic_high")?.detail).toBe(
      "sim=0.61",
    );
    expect(codes(out.reasons)).not.toContain("semantic");

    const edge = scoreCandidate(
      facts({ term_hits: ["lapis"], similarity: 0.55 }),
      profile(),
    );
    expect(weight(edge.reasons, "semantic_high")).toBe(20);
  });

  it("gives +10 semantic between 0.40 and 0.55", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], similarity: 0.4 }),
      profile(),
    );
    expect(weight(out.reasons, "semantic")).toBe(10);
    expect(out.reasons.find((r) => r.code === "semantic")?.detail).toBe("sim=0.40");
    expect(codes(out.reasons)).not.toContain("semantic_high");
  });

  it("emits no semantic reason below 0.40", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], similarity: 0.39 }),
      profile(),
    );
    expect(codes(out.reasons)).toEqual(["term_enrichment", "state_ok", "value_ok"]);
  });

  it("adds to — and never replaces — the other signals", () => {
    const base = facts({ cnae_hits_primary: ["4761003"], term_hits: ["lapis"] });
    const without = scoreCandidate(base, profile());
    const withSim = scoreCandidate({ ...base, similarity: 0.7 }, profile());
    expect(withSim.score - without.score).toBe(20);
    expect(codes(withSim.reasons).slice(0, 4)).toEqual(codes(without.reasons));
  });

  it("still clamps at 100 when everything fires", () => {
    const out = scoreCandidate(
      facts({
        cnae_hits_primary: ["4761003"],
        term_hits: ["lapis", "caneta"],
        estimated_value: "1000.00",
        similarity: 0.9,
      }),
      profile({ states: ["RJ"], min_value: "100.00", max_value: "10000.00" }),
    );
    // 35 + 35 + 10 + 10 + 20 = 110 raw
    expect(out.score).toBe(100);
  });
});

describe("scoreCandidate — CNAE", () => {
  it("gives +35 for a primary hit, with the code as detail", () => {
    const out = scoreCandidate(facts({ cnae_hits_primary: ["4761003"] }), profile());
    expect(weight(out.reasons, "cnae_primary")).toBe(35);
    expect(out.reasons[0].detail).toBe("4761003");
  });

  it("gives +25 for a secondary hit", () => {
    const out = scoreCandidate(facts({ cnae_hits_secondary: ["4789099"] }), profile());
    expect(weight(out.reasons, "cnae_secondary")).toBe(25);
    expect(out.reasons[0].detail).toBe("4789099");
  });

  it("prefers primary and never emits both", () => {
    const out = scoreCandidate(
      facts({ cnae_hits_primary: ["4761003"], cnae_hits_secondary: ["4789099"] }),
      profile(),
    );
    expect(codes(out.reasons)).toContain("cnae_primary");
    expect(codes(out.reasons)).not.toContain("cnae_secondary");
  });

  it("emits no reason when there is no CNAE hit", () => {
    const out = scoreCandidate(facts({ text_hit: true }), profile());
    expect(codes(out.reasons)).not.toContain("cnae_primary");
    expect(codes(out.reasons)).not.toContain("cnae_secondary");
  });
});

describe("scoreCandidate — terms", () => {
  it("gives +35 for two or more enrichment hits, joined by ', '", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis", "caneta"] }),
      profile({ terms: ["lapis", "caneta"] }),
    );
    expect(weight(out.reasons, "term_enrichment")).toBe(35);
    expect(out.reasons[0].detail).toBe("lapis, caneta");
  });

  it("gives +25 for exactly one enrichment hit", () => {
    const out = scoreCandidate(facts({ term_hits: ["lapis"] }), profile());
    expect(weight(out.reasons, "term_enrichment")).toBe(25);
  });

  it("falls back to +15 term_text when only the FTS hit exists", () => {
    const out = scoreCandidate(facts({ text_hit: true }), profile());
    expect(weight(out.reasons, "term_text")).toBe(15);
    expect(codes(out.reasons)).not.toContain("term_enrichment");
  });

  it("ignores text_hit when there is an enrichment hit", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], text_hit: true }),
      profile(),
    );
    expect(codes(out.reasons)).not.toContain("term_text");
  });
});

describe("scoreCandidate — state", () => {
  it("gives +10 when the profile has no state restriction", () => {
    const out = scoreCandidate(facts({ term_hits: ["lapis"] }), profile({ states: [] }));
    expect(weight(out.reasons, "state_ok")).toBe(10);
  });

  it("gives +10 when the state is listed", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], state: "RJ" }),
      profile({ states: ["SP", "RJ"] }),
    );
    expect(weight(out.reasons, "state_ok")).toBe(10);
  });

  it("gives −20 when the state is outside the list", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], state: "BA" }),
      profile({ states: ["RJ"] }),
    );
    expect(weight(out.reasons, "state_out")).toBe(-20);
  });

  it("treats a null state as out when the profile restricts states", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], state: null }),
      profile({ states: ["RJ"] }),
    );
    expect(weight(out.reasons, "state_out")).toBe(-20);
  });
});

describe("scoreCandidate — value", () => {
  it("gives +5 when the value is unknown", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], estimated_value: null }),
      profile(),
    );
    expect(weight(out.reasons, "value_unknown")).toBe(5);
  });

  it("gives +10 inside the range, comparing numeric strings with Number()", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], estimated_value: "184000.00" }),
      profile({ min_value: "50000.00", max_value: "1000000.00" }),
    );
    expect(weight(out.reasons, "value_ok")).toBe(10);
    expect(out.reasons.find((r) => r.code === "value_ok")?.detail).toBe("184000.00");
  });

  it("treats a null bound as open", () => {
    const below = scoreCandidate(
      facts({ term_hits: ["lapis"], estimated_value: "10.00" }),
      profile({ min_value: null, max_value: "100.00" }),
    );
    expect(weight(below.reasons, "value_ok")).toBe(10);

    const above = scoreCandidate(
      facts({ term_hits: ["lapis"], estimated_value: "9999999.00" }),
      profile({ min_value: "100.00", max_value: null }),
    );
    expect(weight(above.reasons, "value_ok")).toBe(10);
  });

  it("gives −15 below the minimum and above the maximum", () => {
    const low = scoreCandidate(
      facts({ term_hits: ["lapis"], estimated_value: "184000.00" }),
      profile({ min_value: "200000.00", max_value: null }),
    );
    expect(weight(low.reasons, "value_out")).toBe(-15);

    const high = scoreCandidate(
      facts({ term_hits: ["lapis"], estimated_value: "184000.00" }),
      profile({ min_value: null, max_value: "100000.00" }),
    );
    expect(weight(high.reasons, "value_out")).toBe(-15);
  });

  it("includes the bounds themselves", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], estimated_value: "100000.00" }),
      profile({ min_value: "100000.00", max_value: "100000.00" }),
    );
    expect(weight(out.reasons, "value_ok")).toBe(10);
  });
});

describe("scoreCandidate — flags", () => {
  it("penalizes −40 for an ME/EPP-exclusive procurement when the size does not qualify", () => {
    const f = facts({ cnae_hits_primary: ["4761003"], me_epp_exclusive: true });
    const large = scoreCandidate(f, profile({ size: "LARGE" }));
    const me = scoreCandidate(f, profile({ size: "ME" }));

    expect(me.score - large.score).toBe(40);
    expect(weight(large.reasons, "me_epp_exclusive")).toBe(-40);
    expect(codes(me.reasons)).not.toContain("me_epp_exclusive");
  });

  it("does not penalize MEI, ME or EPP", () => {
    const f = facts({ term_hits: ["lapis"], me_epp_exclusive: true });
    for (const size of ["MEI", "ME", "EPP"]) {
      expect(codes(scoreCandidate(f, profile({ size })).reasons)).not.toContain(
        "me_epp_exclusive",
      );
    }
    expect(codes(scoreCandidate(f, profile({ size: null })).reasons)).toContain(
      "me_epp_exclusive",
    );
  });

  it("gives −5 for certification and −5 for a technical certificate", () => {
    const out = scoreCandidate(
      facts({
        term_hits: ["lapis"],
        requires_certification: true,
        requires_technical_certificate: true,
      }),
      profile(),
    );
    expect(weight(out.reasons, "requires_certification")).toBe(-5);
    expect(weight(out.reasons, "requires_technical_certificate")).toBe(-5);
    // 25 + 10 + 10 − 5 − 5
    expect(out.score).toBe(35);
  });

  it("ignores null and false flags", () => {
    const out = scoreCandidate(
      facts({
        term_hits: ["lapis"],
        me_epp_exclusive: false,
        requires_certification: false,
        requires_technical_certificate: null,
      }),
      profile({ size: "LARGE" }),
    );
    expect(codes(out.reasons)).toEqual(["term_enrichment", "state_ok", "value_ok"]);
  });

  it("gives −50 for an exclusion hit", () => {
    const out = scoreCandidate(
      facts({ term_hits: ["lapis"], exclusion_hit: true }),
      profile(),
    );
    expect(weight(out.reasons, "exclusion")).toBe(-50);
    // 25 + 10 + 10 − 50 = −5 → clamped to 0
    expect(out.score).toBe(0);
  });
});

describe("scoreCandidate — clamping", () => {
  it("never exceeds 100 — the best possible candidate scores 90", () => {
    const out = scoreCandidate(
      facts({
        cnae_hits_primary: ["4761003"],
        term_hits: ["lapis", "caneta"],
        estimated_value: "1000.00",
      }),
      profile({ states: ["RJ"], min_value: "100.00", max_value: "10000.00" }),
    );
    // 35 (cnae) + 35 (2 terms) + 10 (state) + 10 (value) = 90, the ceiling.
    expect(out.score).toBe(90);
    expect(out.score).toBeLessThanOrEqual(100);
  });

  it("clamps at 0 but keeps the raw weights in the reasons", () => {
    const out = scoreCandidate(
      facts({
        term_hits: ["lapis"],
        state: "BA",
        estimated_value: "1.00",
        me_epp_exclusive: true,
        exclusion_hit: true,
      }),
      profile({ states: ["RJ"], min_value: "1000.00", size: "LARGE" }),
    );
    expect(out.score).toBe(0);
    expect(weight(out.reasons, "me_epp_exclusive")).toBe(-40);
    expect(weight(out.reasons, "exclusion")).toBe(-50);
  });
});
