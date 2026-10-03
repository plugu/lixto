// Deterministic match scoring: enriched procurement facts × company profile →
// a 0–100 score plus machine-readable reasons. Pure, no I/O, no LLM.
//
// The weights below are the product decision and are fixed: the SQL side
// (match-queries.ts) only gathers facts, every judgement happens here so it is
// unit-testable and reproducible. On demand, never persisted — a just-edited
// profile is reflected on the next request.

/** Version of the weights below, stamped on every persisted `matches` row
 * (ADR 001 §D5). Bump it whenever a weight or rule changes, so old scores stay
 * interpretable and a rescore can be told apart from a rerun. */
// v2: facts now sourced from ingest classification + item benefit (ticket 185).
export const MATCH_ENGINE_VERSION = "2";

export type ReasonCode =
  | "cnae_primary"
  | "cnae_secondary"
  | "term_enrichment"
  | "term_text"
  | "state_ok"
  | "state_out"
  | "value_ok"
  | "value_out"
  | "value_unknown"
  | "me_epp_exclusive"
  | "requires_certification"
  | "requires_technical_certificate"
  | "exclusion"
  | "semantic_high"
  | "semantic"
  | "no_profile";

export type Reason = { code: ReasonCode; weight: number; detail: string };

export type CandidateFacts = {
  /** Public identifier (`procurements.source_id`). */
  source_id: string;
  state: string | null;
  estimated_value: string | null;
  cnae_hits_primary: string[];
  cnae_hits_secondary: string[];
  /** profile.terms ∩ (enrichment.keywords ∪ concepts) */
  term_hits: string[];
  /** FTS hit of the profile terms on the description / item descriptions */
  text_hit: boolean;
  /** FTS hit of the profile exclusions on the description / item descriptions */
  exclusion_hit: boolean;
  me_epp_exclusive: boolean | null;
  requires_certification: boolean | null;
  requires_technical_certificate: boolean | null;
  /** Cosine similarity (0..1) between the profile vector and the procurement
   * vector; null when either side has no embedding. */
  similarity: number | null;
};

export type ProfileSummary = {
  terms: string[];
  states: string[];
  min_value: string | null;
  max_value: string | null;
  /** `companies.size` — MEI/ME/EPP qualify for ME/EPP-only procurements. */
  size: string | null;
};

/** Sizes that qualify for a procurement reserved to ME/EPP (LC 123/2006). */
const ME_EPP_SIZES = new Set(["MEI", "ME", "EPP"]);

function clamp(score: number): number {
  return Math.max(0, Math.min(100, score));
}

/**
 * Scores one candidate against one profile. Every applied rule line becomes a
 * `Reason` carrying its own `weight`, so the UI can explain the number without
 * re-deriving it. The sum is clamped to 0..100 (max raw is 110 since the
 * semantic band was added) but the reasons keep their raw weights on purpose
 * (a −40 ME/EPP penalty stays visible even at score 0).
 */
export function scoreCandidate(
  f: CandidateFacts,
  p: ProfileSummary,
): { score: number; reasons: Reason[] } {
  const hasCnae =
    f.cnae_hits_primary.length > 0 || f.cnae_hits_secondary.length > 0;

  // Nothing to match on: a company with no terms, no CNAE overlap and no
  // semantic signal gets a single honest reason instead of a score built out
  // of state/value noise. A similarity alone is enough to keep scoring.
  if (p.terms.length === 0 && !hasCnae && f.similarity === null) {
    return {
      score: 0,
      reasons: [
        {
          code: "no_profile",
          weight: 0,
          detail: "Sem termos e sem CNAE em comum",
        },
      ],
    };
  }

  const reasons: Reason[] = [];
  let score = 0;

  const add = (code: ReasonCode, weight: number, detail: string) => {
    reasons.push({ code, weight, detail });
    score += weight;
  };

  // CNAE: primary beats secondary, never both.
  if (f.cnae_hits_primary.length > 0) {
    add("cnae_primary", 35, f.cnae_hits_primary.join(", "));
  } else if (f.cnae_hits_secondary.length > 0) {
    add("cnae_secondary", 25, f.cnae_hits_secondary.join(", "));
  }

  // Terms: enrichment keywords first, raw full-text as the weaker fallback.
  if (f.term_hits.length >= 2) {
    add("term_enrichment", 35, f.term_hits.join(", "));
  } else if (f.term_hits.length === 1) {
    add("term_enrichment", 25, f.term_hits.join(", "));
  } else if (f.text_hit) {
    add("term_text", 15, "Termos encontrados no objeto ou nos itens");
  }

  // State: an empty list in the profile means "todas".
  if (p.states.length === 0 || (f.state !== null && p.states.includes(f.state))) {
    add("state_ok", 10, f.state ?? "UF não informada");
  } else {
    add("state_out", -20, f.state ?? "UF não informada");
  }

  // Value: numeric strings ("184000.00") compared with Number().
  if (f.estimated_value === null) {
    add("value_unknown", 5, "Valor estimado não informado");
  } else {
    const value = Number(f.estimated_value);
    const min = p.min_value === null ? null : Number(p.min_value);
    const max = p.max_value === null ? null : Number(p.max_value);
    const inside = (min === null || value >= min) && (max === null || value <= max);
    if (inside) {
      add("value_ok", 10, f.estimated_value);
    } else {
      add("value_out", -15, f.estimated_value);
    }
  }

  if (f.me_epp_exclusive === true && !ME_EPP_SIZES.has(p.size ?? "")) {
    add(
      "me_epp_exclusive",
      -40,
      `Exclusiva para ME/EPP; porte: ${p.size ?? "não informado"}`,
    );
  }

  if (f.requires_certification === true) {
    add("requires_certification", -5, "Exige certificação");
  }

  if (f.requires_technical_certificate === true) {
    add(
      "requires_technical_certificate",
      -5,
      "Exige atestado de capacidade técnica",
    );
  }

  if (f.exclusion_hit) {
    add("exclusion", -50, "Termo de exclusão encontrado");
  }

  // Semantic proximity between the profile vector and the procurement vector.
  // Fixed bands, deliberately worth less than a CNAE or keyword hit: it is a
  // recall booster, not a substitute for a hard signal.
  if (f.similarity !== null) {
    const detail = `sim=${f.similarity.toFixed(2)}`;
    if (f.similarity >= 0.55) {
      add("semantic_high", 20, detail);
    } else if (f.similarity >= 0.4) {
      add("semantic", 10, detail);
    }
  }

  return { score: clamp(score), reasons };
}
