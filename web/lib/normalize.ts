// Shared term normalization for the match engine. Must produce the same output
// as the Python `normalize_term` for ASCII/Latin input — lowercase, accents
// stripped, single-spaced. Used both for `company_profiles.terms` and for the
// enrichment keywords written by the CLI.

/** Lowercase, strip diacritics, collapse whitespace, trim, cap at 40 chars. */
export function normalizeTerm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** Maps `normalizeTerm`, drops empties, dedupes preserving order, caps at 50. */
export function normalizeTerms(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const term = normalizeTerm(x);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= 50) break;
  }
  return out;
}
