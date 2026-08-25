// Queries for the /company/profile match profile (`company_profiles`, ADR 001
// §D4). Every function takes `companyId` explicitly and callers must always
// source it from the session — the tenant golden rule (docs/TENANT.md).
//
// This table is the company side of the match engine: `terms` /
// `exclusion_terms` are the normalized arrays the scorer reads, and
// `embedding` is the semantic side of the same profile.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable in the .test.ts files.

import { toPgVector } from "./agent/embed";
import { pool } from "./db";
import { normalizeTerms } from "./normalize";

export type CompanyProfile = {
  company_id: number;
  products: string[];
  keywords: string[];
  exclusions: string[];
  terms: string[];
  exclusion_terms: string[];
  states: string[];
  min_value: string | null;
  max_value: string | null;
  notes: string | null;
  /** Text the stored `embedding` was built from. The vector column itself is
   * never selected here: 1536 floats are large and unused in TS. */
  embedding_text: string | null;
};

/** A freshly computed embedding for the profile. Kept apart from
 * `getProfile` so callers (and their mocks) that only need the profile fields
 * are unaffected. */
export type ProfileEmbedding = {
  vector: number[];
  model: string;
  text: string;
};

export type ProfileInput = {
  products: string[];
  keywords: string[];
  exclusions: string[];
  states: string[];
  minValue: string;
  maxValue: string;
  notes: string;
};

export type SqlQuery = {
  text: string;
  values: unknown[];
};

export async function getProfile(
  companyId: number,
): Promise<CompanyProfile | null> {
  const { rows } = await pool.query<CompanyProfile>(
    `SELECT company_id, products, keywords, exclusions, terms,
            exclusion_terms, states, min_value, max_value, notes,
            embedding_text
       FROM company_profiles
      WHERE company_id = $1`,
    [companyId],
  );
  return rows[0] ?? null;
}

/** The stored profile vector, already in pgvector's text form so it can be
 * bound as `$n::vector`. Null when absent — the match engine then simply has
 * no semantic signal. */
export async function getProfileEmbeddingText(
  companyId: number,
): Promise<string | null> {
  const { rows } = await pool.query<{ embedding: string | null }>(
    `SELECT embedding::text AS embedding FROM company_profiles WHERE company_id = $1`,
    [companyId],
  );
  return rows[0]?.embedding ?? null;
}

function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Empty → null. Accepts "50000", "50.000,00", "R$ 50.000,00": strips
 * everything except digits and the last comma, which becomes the decimal
 * point (thousand separators — dots or extra commas — are dropped). */
export function parseMoney(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^0-9.,]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  if (lastComma === -1) {
    const digitsOnly = cleaned.replace(/\./g, "");
    return digitsOnly.length === 0 ? null : digitsOnly;
  }
  const intPart = cleaned.slice(0, lastComma).replace(/[.,]/g, "");
  const fracPart = cleaned.slice(lastComma + 1).replace(/[.,]/g, "");
  return `${intPart}.${fracPart}`;
}

/** Splits on newline/comma/semicolon, trims, drops empties, dedupes
 * (preserving raw casing/order), caps at 50. */
export function parseTermList(raw: string): string[] {
  const parts = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 50) break;
  }
  return out;
}

/** Builds the `company_profiles` upsert. `companyId` is always $1. Computes
 * `terms` from products ∪ keywords (normalized) and `exclusion_terms` from
 * exclusions (normalized). */
export function buildUpsertProfile(
  companyId: number,
  input: ProfileInput,
  embedding?: ProfileEmbedding | null,
): SqlQuery {
  const terms = normalizeTerms([...input.products, ...input.keywords]);
  const exclusionTerms = normalizeTerms(input.exclusions);
  const states = input.states
    .map((state) => state.trim().toUpperCase())
    .filter(Boolean);

  const values: unknown[] = [
    companyId,
    input.products,
    input.keywords,
    input.exclusions,
    terms,
    exclusionTerms,
    states,
    parseMoney(input.minValue),
    parseMoney(input.maxValue),
    nullIfEmpty(input.notes),
  ];

  // Without a fresh embedding the three columns are simply left out: on
  // insert they default to NULL, on conflict they keep whatever was there —
  // a provider outage must never wipe a working vector.
  let embeddingColumns = "";
  let embeddingValues = "";
  let embeddingSet = "";
  if (embedding) {
    const vector = `$${values.push(toPgVector(embedding.vector))}::vector`;
    const text = `$${values.push(embedding.text)}`;
    const model = `$${values.push(embedding.model)}`;
    embeddingColumns = ", embedding, embedding_text, embedding_model";
    embeddingValues = `, ${vector}, ${text}, ${model}`;
    embeddingSet = `,
      embedding = ${vector},
      embedding_text = ${text},
      embedding_model = ${model}`;
  }

  const text = `
    INSERT INTO company_profiles (
      company_id, products, keywords, exclusions, terms,
      exclusion_terms, states, min_value, max_value, notes, updated_at${embeddingColumns}
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()${embeddingValues})
    ON CONFLICT (company_id) DO UPDATE SET
      products = EXCLUDED.products,
      keywords = EXCLUDED.keywords,
      exclusions = EXCLUDED.exclusions,
      terms = EXCLUDED.terms,
      exclusion_terms = EXCLUDED.exclusion_terms,
      states = EXCLUDED.states,
      min_value = EXCLUDED.min_value,
      max_value = EXCLUDED.max_value,
      notes = EXCLUDED.notes,
      updated_at = now()${embeddingSet}
  `;
  return { text, values };
}

export async function upsertProfile(
  companyId: number,
  input: ProfileInput,
  embedding?: ProfileEmbedding | null,
): Promise<void> {
  const { text, values } = buildUpsertProfile(companyId, input, embedding);
  await pool.query(text, values);
}
