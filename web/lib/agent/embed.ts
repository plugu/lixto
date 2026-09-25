// Embedding client for the semantic layer. Mirrors llm.ts: same env names as
// the Python side (src/lixto/settings.py) so one .env drives both runtimes,
// and the client is built per call so `next build` never needs a key.
//
// Embeddings are best-effort on the web side: `embedText` returns null instead
// of throwing, so saving the profile always succeeds even without a provider.

import OpenAI from "openai";

export const EMBED_MODEL =
  process.env.LIXTO_LLM_MODEL_EMBED ?? "text-embedding-3-small";

/** Dimension of `text-embedding-3-small`, matching `vector(1536)` in the DDL. */
export const EMBED_DIMS = 1536;

/** node-pg has no vector type: bind the literal as text and cast with
 * `$n::vector` in SQL. `[0.1,0.2,...]` is pgvector's input format. */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/** Canonical text for the company side of the match. Empty parts are skipped
 * so an empty profile never embeds a document made only of labels. Labels stay
 * Portuguese: the corpus they are compared against is Portuguese too. */
export function buildProfileEmbeddingText(input: {
  products: string[];
  keywords: string[];
  notes: string;
}): string {
  const parts: string[] = [];
  const products = input.products.filter((p) => p.trim().length > 0);
  const keywords = input.keywords.filter((k) => k.trim().length > 0);
  const notes = input.notes.trim();
  if (products.length > 0) parts.push(`produtos: ${products.join(", ")}`);
  if (keywords.length > 0) parts.push(`palavras-chave: ${keywords.join(", ")}`);
  if (notes.length > 0) parts.push(`observações: ${notes}`);
  return parts.join("\n");
}

function getEmbedClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.LIXTO_LLM_API_KEY ?? process.env.OPENAI_API_KEY,
    baseURL: process.env.LIXTO_LLM_BASE_URL || undefined,
  });
}

/**
 * Embeds one text. Returns null (with a warning) when no API key is
 * configured, the text is empty, or the SDK throws — callers treat the
 * embedding as optional.
 */
export async function embedText(
  text: string,
  deps: { client?: OpenAI; model?: string } = {},
): Promise<{ vector: number[]; model: string } | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const model = deps.model ?? EMBED_MODEL;
  const client =
    deps.client ??
    (process.env.LIXTO_LLM_API_KEY || process.env.OPENAI_API_KEY
      ? getEmbedClient()
      : null);
  if (client === null) {
    console.warn("[embed] no LIXTO_LLM_API_KEY/OPENAI_API_KEY; skipping embedding");
    return null;
  }

  try {
    const res = await client.embeddings.create({ model, input: trimmed, dimensions: EMBED_DIMS });
    const vector = res.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      console.warn("[embed] response carried no embedding");
      return null;
    }
    if (vector.length !== EMBED_DIMS) {
      console.warn(
        `[embed] unexpected embedding dimensions: expected ${EMBED_DIMS}, got ${vector.length}`,
      );
      return null;
    }
    return { vector: vector as number[], model };
  } catch (err) {
    console.warn("[embed] failed to generate the embedding:", err);
    return null;
  }
}

const DEFAULT_EMBED_CACHE_SIZE = 500;

/** Process-wide memo of search-text embeddings: `${model}:${normalised q}` →
 * pgvector literal. Single Node process, so paging or re-running the same
 * search never calls the embeddings API twice; a deploy clears it. Map
 * iteration order is insertion order, which gives FIFO eviction. */
const queryEmbeddingCache = new Map<string, string>();

/** `LIXTO_WEB_EMBED_CACHE_SIZE`, read at call time; anything non-finite or
 * <= 0 falls back to the default. */
function embedCacheSize(): number {
  const parsed = Number(process.env.LIXTO_WEB_EMBED_CACHE_SIZE);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_EMBED_CACHE_SIZE;
}

/** Case, surrounding and repeated whitespace don't change what the user is
 * searching for, so they share one cache entry. */
function normaliseQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Test-only: empties the query-embedding memo. */
export function resetEmbedCache(): void {
  queryEmbeddingCache.clear();
}

/**
 * Embeds a user's free-text search and returns it as a pgvector literal, ready
 * to bind as `$n::vector` (see `buildListQuery` in lib/procurement-queries.ts).
 * Returns null on any failure — no key, empty text, provider error — so search
 * degrades to keyword-only instead of erroring.
 *
 * Successful results are memoised per process (see `queryEmbeddingCache`);
 * failures are not, so a transient provider error is retried next time.
 */
export async function embedQuery(
  q: string,
  deps: { client?: OpenAI; model?: string } = {},
): Promise<string | null> {
  const model = deps.model ?? EMBED_MODEL;
  const key = `${model}:${normaliseQuery(q)}`;
  const hit = queryEmbeddingCache.get(key);
  if (hit !== undefined) return hit;

  const embedding = await embedText(q, { ...deps, model });
  if (embedding === null) return null;

  const literal = toPgVector(embedding.vector);
  if (!queryEmbeddingCache.has(key)) {
    while (queryEmbeddingCache.size >= embedCacheSize()) {
      const oldest = queryEmbeddingCache.keys().next().value;
      if (oldest === undefined) break;
      queryEmbeddingCache.delete(oldest);
    }
  }
  queryEmbeddingCache.set(key, literal);
  return literal;
}
