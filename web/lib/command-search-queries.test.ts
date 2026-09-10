import { describe, expect, it } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.
import {
  buildCommandSearchQuery,
  COMMAND_SEARCH_LIMIT,
} from "./command-search-queries";
import { matchShortcut, NAV_SHORTCUTS } from "./keyboard-shortcuts";
import { ACTIVE_PORTALS } from "./portals";

describe("buildCommandSearchQuery", () => {
  it("binds the portal allowlist, the query and the limit, in that order", () => {
    const { values } = buildCommandSearchQuery("limpeza");

    expect(values).toEqual([ACTIVE_PORTALS, "limpeza", COMMAND_SEARCH_LIMIT]);
  });

  it("honours an explicit limit", () => {
    const { values } = buildCommandSearchQuery("limpeza", 3);

    expect(values[2]).toBe(3);
  });

  it("never interpolates the query text into the SQL", () => {
    const { text } = buildCommandSearchQuery("'; DROP TABLE procurements; --");

    expect(text).not.toContain("DROP TABLE");
    expect(text).toContain("f_unaccent($2)");
  });

  it("uses the same unaccented portuguese FTS expression as the list page", () => {
    const { text } = buildCommandSearchQuery("lapis");

    expect(text).toContain(
      "to_tsvector('portuguese', f_unaccent(coalesce(procurements.description, '')))",
    );
    expect(text).toContain("websearch_to_tsquery('portuguese', f_unaccent($2))");
  });

  it("is keyword-only — no embedding / vector branch", () => {
    const { text } = buildCommandSearchQuery("limpeza");

    expect(text).not.toContain("::vector");
    expect(text).not.toContain("embedding");
  });

  it("selects the palette columns and joins the agency", () => {
    const { text } = buildCommandSearchQuery("limpeza");

    expect(text).toContain("procurements.source_id");
    expect(text).toContain("procurements.description");
    expect(text).toContain("agencies.name AS agency_name");
    expect(text).toContain("procurements.state");
    expect(text).toContain("procurements.proposal_closes_at");
    expect(text).toContain(
      "JOIN agencies ON agencies.tax_id = procurements.agency_tax_id",
    );
  });

  it("orders by rank then closing date, and limits", () => {
    const { text } = buildCommandSearchQuery("limpeza");

    expect(text).toMatch(/ORDER BY\s+ts_rank\(/);
    expect(text).toContain("procurements.proposal_closes_at DESC NULLS LAST");
    expect(text).toContain("LIMIT $3");
  });

  it("applies the platform portal allowlist", () => {
    const { text } = buildCommandSearchQuery("limpeza");

    expect(text).toContain("procurements.origin_system = ANY($1)");
  });
});

describe("matchShortcut", () => {
  it("matches a full chord", () => {
    expect(matchShortcut("g o", ["g", "o"])).toBe("match");
  });

  it("reports a viable prefix", () => {
    expect(matchShortcut("g o", ["g"])).toBe("prefix");
  });

  it("matches a single-key binding", () => {
    expect(matchShortcut("?", ["?"])).toBe("match");
  });

  it("rejects a wrong second key", () => {
    expect(matchShortcut("g o", ["g", "x"])).toBe("none");
  });

  it("rejects a wrong first key", () => {
    expect(matchShortcut("g o", ["x"])).toBe("none");
  });

  it("rejects keys longer than the binding", () => {
    expect(matchShortcut("g o", ["g", "o", "o"])).toBe("none");
  });

  it("rejects an empty buffer", () => {
    expect(matchShortcut("g o", [])).toBe("none");
  });

  it("covers every nav shortcut with a distinct sequence", () => {
    const sequences = Object.values(NAV_SHORTCUTS);

    expect(new Set(sequences).size).toBe(sequences.length);
    for (const sequence of sequences) {
      expect(matchShortcut(sequence, sequence.split(" "))).toBe("match");
    }
  });
});
