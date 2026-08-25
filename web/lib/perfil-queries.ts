// Queries for the /empresa/perfil matching profile (ticket 65). Every
// function takes `empresaId` explicitly and callers must always source it
// from the session — the tenant rule for this cycle. This table replaces
// company_profile.md as the company side of the match engine (ticket 66).

import { toPgVector } from "./agent/embed";
import { pool } from "./db";
import { normalizeTerms } from "./normalize";

export type PerfilMatch = {
  empresa_id: number;
  produtos: string[];
  palavras_chave: string[];
  exclusoes: string[];
  termos: string[];
  exclusoes_termos: string[];
  ufs: string[];
  valor_min: string | null;
  valor_max: string | null;
  observacoes: string | null;
  /** Text the stored `embedding` was built from. The vector column itself is
   * never selected here: 1536 floats are large and unused in TS. */
  embedding_texto: string | null;
};

/** The perfil embedding as pgvector's text literal (`"[0.1,...]"`), or null
 * when the empresa has no perfil row or never got embedded. Kept apart from
 * `getPerfil` so callers (and their mocks) that only need the profile fields
 * are unaffected. */
export type PerfilEmbedding = { vector: number[]; model: string; texto: string };

export type PerfilInput = {
  produtos: string[];
  palavrasChave: string[];
  exclusoes: string[];
  ufs: string[];
  valorMin: string;
  valorMax: string;
  observacoes: string;
};

export type SqlQuery = {
  text: string;
  values: unknown[];
};

export async function getPerfil(empresaId: number): Promise<PerfilMatch | null> {
  const { rows } = await pool.query<PerfilMatch>(
    `SELECT empresa_id, produtos, palavras_chave, exclusoes, termos,
            exclusoes_termos, ufs, valor_min, valor_max, observacoes,
            embedding_texto
       FROM empresa_perfil
      WHERE empresa_id = $1`,
    [empresaId],
  );
  return rows[0] ?? null;
}

/** The stored perfil vector, already in pgvector's text form so it can be
 * bound as `$n::vector`. Null when absent — the match engine then simply has
 * no semantic signal. */
export async function getPerfilEmbeddingText(
  empresaId: number,
): Promise<string | null> {
  const { rows } = await pool.query<{ embedding: string | null }>(
    `SELECT embedding::text AS embedding FROM empresa_perfil WHERE empresa_id = $1`,
    [empresaId],
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
export function parseValor(raw: string): string | null {
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

/** Builds the empresa_perfil upsert. `empresaId` is always $1. Computes
 * `termos` from produtos ∪ palavras_chave (normalized) and `exclusoes_termos`
 * from exclusoes (normalized). */
export function buildUpsertPerfil(
  empresaId: number,
  input: PerfilInput,
  embedding?: PerfilEmbedding | null,
): SqlQuery {
  const termos = normalizeTerms([...input.produtos, ...input.palavrasChave]);
  const exclusoesTermos = normalizeTerms(input.exclusoes);
  const ufs = input.ufs.map((uf) => uf.trim().toUpperCase()).filter(Boolean);

  const values: unknown[] = [
    empresaId,
    input.produtos,
    input.palavrasChave,
    input.exclusoes,
    termos,
    exclusoesTermos,
    ufs,
    parseValor(input.valorMin),
    parseValor(input.valorMax),
    nullIfEmpty(input.observacoes),
  ];

  // Without a fresh embedding the three columns are simply left out: on
  // insert they default to NULL, on conflict they keep whatever was there —
  // a provider outage must never wipe a working vector.
  let colunasEmbedding = "";
  let valoresEmbedding = "";
  let setEmbedding = "";
  if (embedding) {
    const vetor = `$${values.push(toPgVector(embedding.vector))}::vector`;
    const texto = `$${values.push(embedding.texto)}`;
    const modelo = `$${values.push(embedding.model)}`;
    colunasEmbedding = ", embedding, embedding_texto, embedding_modelo";
    valoresEmbedding = `, ${vetor}, ${texto}, ${modelo}`;
    setEmbedding = `,
      embedding = ${vetor},
      embedding_texto = ${texto},
      embedding_modelo = ${modelo}`;
  }

  const text = `
    INSERT INTO empresa_perfil (
      empresa_id, produtos, palavras_chave, exclusoes, termos,
      exclusoes_termos, ufs, valor_min, valor_max, observacoes, updated_at${colunasEmbedding}
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()${valoresEmbedding})
    ON CONFLICT (empresa_id) DO UPDATE SET
      produtos = EXCLUDED.produtos,
      palavras_chave = EXCLUDED.palavras_chave,
      exclusoes = EXCLUDED.exclusoes,
      termos = EXCLUDED.termos,
      exclusoes_termos = EXCLUDED.exclusoes_termos,
      ufs = EXCLUDED.ufs,
      valor_min = EXCLUDED.valor_min,
      valor_max = EXCLUDED.valor_max,
      observacoes = EXCLUDED.observacoes,
      updated_at = now()${setEmbedding}
  `;
  return { text, values };
}

export async function upsertPerfil(
  empresaId: number,
  input: PerfilInput,
  embedding?: PerfilEmbedding | null,
): Promise<void> {
  const { text, values } = buildUpsertPerfil(empresaId, input, embedding);
  await pool.query(text, values);
}
