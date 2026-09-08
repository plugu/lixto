// Deterministic *opportunity* scoring for the Radar: "how likely is it that
// this planned purchase actually happens, and soon?". Pure, no I/O, no LLM —
// modelled on web/lib/match-engine.ts.
//
// This is NOT the company match score (that is ticket 126, a separate 0–100).
// Here the only inputs are PCA facts: the item exists in a plan, how close its
// desired date is, and how recently the plan was updated at the source.
//
// Copy discipline (PRODUCT.md): a PCA item is an *intention*, never a
// confirmed tender. Every detail string says "previsto"/"estimado" and none of
// them may claim anything is "confirmado".
//
// Ticket 126 adds the *company match* score (`scoreCompanyMatch`, below): a
// second, separate 0..100 number — "how well does this PCA item fit this
// company's profile?". It reuses `Reason`/`ReasonCode`/`ProfileSummary` from
// `./match-engine` rather than redefining them, since the shape (weighted
// reason list, same profile fields) is identical to the reactive match engine.

import type { ProfileSummary, Reason, ReasonCode } from "./match-engine";

/** Version of the weights and bands below, stamped on every
 * `future_opportunities` row. Bump it whenever a weight or rule changes, so
 * old scores stay interpretable and a rescore can be told from a rerun. */
export const RADAR_ENGINE_VERSION = "1";

/** Version of the company-match weights below, stamped on every
 * `future_opportunity_matches` row. */
export const RADAR_MATCH_ENGINE_VERSION = "1";

export type SignalCode =
  | "pca_item"
  | "date_near"
  | "date_mid"
  | "date_far"
  | "recent_plan_update";

export type Signal = { code: SignalCode; weight: number; detail: string };

export type RadarWeights = {
  pcaItem: number;
  dateNear: number;
  dateMid: number;
  recentUpdate: number;
};

/** Product defaults (PRODUCT.md §"Two separate scores"). A plain PCA item with
 * no date and a stale plan scores 50: real, but nothing says it is imminent. */
export const DEFAULT_WEIGHTS: RadarWeights = {
  pcaItem: 50,
  dateNear: 30,
  dateMid: 15,
  recentUpdate: 20,
};

/** Facts the SQL side gathers per PCA item. Dates are ISO strings (or
 * whatever `pg` hands back as text) so the engine stays serialisable. */
export type RadarFacts = {
  /** `procurement_plan_items.desired_date` — the *estimated* purchase date. */
  expected_date: string | null;
  /** `procurement_plans.source_global_updated_at` — last PNCP touch. */
  plan_updated_at: string | null;
};

/** Upper bound (inclusive) in days for the `date_near` band. */
const NEAR_DAYS = 90;
/** Upper bound (inclusive) in days for the `date_mid` band. */
const MID_DAYS = 180;
/** A plan touched at the source within this many days is "alive". */
const RECENT_UPDATE_DAYS = 60;

const MS_PER_DAY = 86_400_000;

function clamp(score: number): number {
  return Math.max(0, Math.min(100, score));
}

/** Positive finite number from the environment, or the default. Zero is
 * allowed (an operator disabling a signal); negatives and junk are not. */
function envWeight(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/**
 * Weights from `LIXTO_RADAR_WEIGHT_*`, falling back to `DEFAULT_WEIGHTS` for
 * anything missing or invalid. Read at call time (not module load) so a test
 * — or a redeploy with new env — sees the change.
 */
export function loadWeights(
  env: Record<string, string | undefined> = process.env,
): RadarWeights {
  return {
    pcaItem: envWeight(env.LIXTO_RADAR_WEIGHT_PCA_ITEM, DEFAULT_WEIGHTS.pcaItem),
    dateNear: envWeight(env.LIXTO_RADAR_WEIGHT_DATE_NEAR, DEFAULT_WEIGHTS.dateNear),
    dateMid: envWeight(env.LIXTO_RADAR_WEIGHT_DATE_MID, DEFAULT_WEIGHTS.dateMid),
    recentUpdate: envWeight(
      env.LIXTO_RADAR_WEIGHT_RECENT_UPDATE,
      DEFAULT_WEIGHTS.recentUpdate,
    ),
  };
}

/** Whole days from `now` to `iso`, or null when the date is absent/unparsable.
 * Both ends are floored to UTC midnight so "today" is 0 at any hour. */
function daysUntil(iso: string | null, now: Date): number | null {
  if (iso === null) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const day = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(target) - day(now)) / MS_PER_DAY);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/**
 * Scores one PCA item. `pca_item` is always present (the item exists in a
 * published plan — that is the base evidence); the date bands and the plan
 * freshness are additive. `date_far` is emitted with weight 0 so the UI can
 * still explain *why* the date contributed nothing.
 *
 * The sum is clamped to 0..100; signals keep their raw weights.
 */
export function scoreOpportunity(
  f: RadarFacts,
  now: Date,
  w: RadarWeights = DEFAULT_WEIGHTS,
): { score: number; signals: Signal[] } {
  const signals: Signal[] = [];
  let score = 0;

  const add = (code: SignalCode, weight: number, detail: string) => {
    signals.push({ code, weight, detail });
    score += weight;
  };

  add(
    "pca_item",
    w.pcaItem,
    "Item previsto no Plano de Contratações Anual (PCA) do órgão",
  );

  const days = daysUntil(f.expected_date, now);
  if (days === null) {
    add(
      "date_far",
      0,
      "Sem data desejada informada no PCA; período de compra ainda indefinido",
    );
  } else if (days >= 0 && days <= NEAR_DAYS) {
    add(
      "date_near",
      w.dateNear,
      `Data desejada estimada em ${formatDate(f.expected_date as string)} (${days} dia(s))`,
    );
  } else if (days > NEAR_DAYS && days <= MID_DAYS) {
    add(
      "date_mid",
      w.dateMid,
      `Data desejada estimada em ${formatDate(f.expected_date as string)} (${days} dia(s))`,
    );
  } else if (days > MID_DAYS) {
    add(
      "date_far",
      0,
      `Data desejada estimada em ${formatDate(f.expected_date as string)}, a mais de ${MID_DAYS} dias`,
    );
  } else {
    add(
      "date_far",
      0,
      `Data desejada estimada em ${formatDate(f.expected_date as string)} já passou`,
    );
  }

  const updatedAgo = daysUntil(f.plan_updated_at, now);
  if (updatedAgo !== null && updatedAgo <= 0 && updatedAgo >= -RECENT_UPDATE_DAYS) {
    add(
      "recent_plan_update",
      w.recentUpdate,
      `Plano atualizado no PNCP há ${Math.abs(updatedAgo)} dia(s)`,
    );
  }

  return { score: clamp(score), signals };
}

// ---------------------------------------------------------------------------
// Company match score (ticket 126) — deterministic, separate from the
// opportunity score above. Pure, no I/O: the SQL side (radar-match-queries.ts)
// gathers the facts, this only judges them.

/** Facts the SQL side gathers per (company, PCA item) pair. */
export type RadarCandidateFacts = {
  /** `future_opportunities.id`. */
  id: number;
  state: string | null;
  estimated_value: string | null;
  /** FTS hit of the profile terms on the item title. */
  text_hit: boolean;
  /** FTS hit of the profile exclusion terms on the item title. */
  exclusion_hit: boolean;
  /** Cosine similarity (0..1) between the profile vector and the plan-item
   * vector; null when either side has no embedding. */
  similarity: number | null;
};

/** Below this, nothing is persisted to `future_opportunity_matches` — a
 * near-zero score is noise, not a match worth showing. */
export const RADAR_MATCH_MIN = 40;

/**
 * Scores one PCA item against one company profile. Mirrors the shape of
 * `scoreCandidate` in match-engine.ts (weighted reasons, sum clamped 0..100)
 * but with its own, simpler rule set — no CNAE, no enrichment keywords: a PCA
 * item carries neither (PRODUCT.md "CNAE-based reasons" is out of scope).
 */
export function scoreCompanyMatch(
  f: RadarCandidateFacts,
  p: ProfileSummary & { exclusion_terms: string[] },
): { score: number; reasons: Reason[] } {
  // Nothing to match on: no terms and no semantic signal. A single honest
  // reason instead of a score built out of state/value noise alone.
  if (p.terms.length === 0 && f.similarity === null) {
    return {
      score: 0,
      reasons: [
        {
          code: "no_profile",
          weight: 0,
          detail: "Sem termos no perfil e sem similaridade semântica",
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

  if (f.text_hit) {
    add("term_text", 40, "Termos do perfil encontrados no objeto do item");
  }

  // Semantic proximity between the profile vector and the plan-item vector.
  if (f.similarity !== null) {
    const detail = `sim=${f.similarity.toFixed(2)}`;
    if (f.similarity >= 0.55) {
      add("semantic_high", 35, detail);
    } else if (f.similarity >= 0.4) {
      add("semantic", 20, detail);
    }
  }

  // State: an empty profile list means "todas"; an unknown item state (NULL)
  // says nothing either way, so it gets no reason at all.
  if (f.state !== null) {
    if (p.states.length === 0 || p.states.includes(f.state)) {
      add("state_ok", 15, f.state);
    } else {
      add("state_out", -30, f.state);
    }
  }

  // Value: numeric strings ("184000.00") compared with Number().
  if (f.estimated_value === null) {
    add("value_unknown", 0, "Valor estimado não informado");
  } else {
    const value = Number(f.estimated_value);
    const min = p.min_value === null ? null : Number(p.min_value);
    const max = p.max_value === null ? null : Number(p.max_value);
    const inside = (min === null || value >= min) && (max === null || value <= max);
    if (inside) {
      add("value_ok", 10, f.estimated_value);
    } else {
      add("value_out", -20, f.estimated_value);
    }
  }

  if (f.exclusion_hit) {
    add("exclusion", -60, "Termo de exclusão encontrado no objeto do item");
  }

  return { score: clamp(score), reasons };
}
