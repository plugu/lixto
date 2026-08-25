// Embedding client for the semantic layer (ticket 72). Mirrors llm.ts: same
// env names as the Python side (src/plic/settings.py) so one .env drives both
// runtimes, and the client is built per call so `next build` never needs a key.
//
// Embeddings are best-effort on the web side: `embedText` returns null instead
// of throwing, so saving the perfil always succeeds even without a provider.

import OpenAI from "openai";

export const EMBED_MODEL =
  process.env.PLIC_LLM_MODEL_EMBED ?? "text-embedding-3-small";

/** Dimension of `text-embedding-3-small`, matching `vector(1536)` in the DDL. */
export const EMBED_DIMS = 1536;

/** node-pg has no vector type: bind the literal as text and cast with
 * `$n::vector` in SQL. `[0.1,0.2,...]` is pgvector's input format. */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/** Canonical text for the empresa side of the match. Empty parts are skipped
 * so an empty profile never embeds a document made only of labels. */
export function buildPerfilEmbeddingText(input: {
  produtos: string[];
  palavrasChave: string[];
  observacoes: string;
}): string {
  const partes: string[] = [];
  const produtos = input.produtos.filter((p) => p.trim().length > 0);
  const palavras = input.palavrasChave.filter((p) => p.trim().length > 0);
  const obs = input.observacoes.trim();
  if (produtos.length > 0) partes.push(`produtos: ${produtos.join(", ")}`);
  if (palavras.length > 0) partes.push(`palavras-chave: ${palavras.join(", ")}`);
  if (obs.length > 0) partes.push(`observações: ${obs}`);
  return partes.join("\n");
}

function getEmbedClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.PLIC_LLM_API_KEY ?? process.env.OPENAI_API_KEY,
    baseURL: process.env.PLIC_LLM_BASE_URL || undefined,
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
    (process.env.PLIC_LLM_API_KEY || process.env.OPENAI_API_KEY
      ? getEmbedClient()
      : null);
  if (client === null) {
    console.warn("[embed] sem PLIC_LLM_API_KEY/OPENAI_API_KEY; pulando embedding");
    return null;
  }

  try {
    const res = await client.embeddings.create({ model, input: trimmed });
    const vector = res.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      console.warn("[embed] resposta sem embedding");
      return null;
    }
    return { vector: vector as number[], model };
  } catch (err) {
    console.warn("[embed] falha ao gerar embedding:", err);
    return null;
  }
}
