// Queries for the /empresa/perfil matching profile (ticket 65). Every
// function takes `empresaId` explicitly and callers must always source it
// from the session — the tenant rule for this cycle. This table replaces
// company_profile.md as the company side of the match engine (ticket 66).

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
};

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
            exclusoes_termos, ufs, valor_min, valor_max, observacoes
       FROM empresa_perfil
      WHERE empresa_id = $1`,
    [empresaId],
  );
  return rows[0] ?? null;
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
): SqlQuery {
  const termos = normalizeTerms([...input.produtos, ...input.palavrasChave]);
  const exclusoesTermos = normalizeTerms(input.exclusoes);
  const ufs = input.ufs.map((uf) => uf.trim().toUpperCase()).filter(Boolean);

  const text = `
    INSERT INTO empresa_perfil (
      empresa_id, produtos, palavras_chave, exclusoes, termos,
      exclusoes_termos, ufs, valor_min, valor_max, observacoes, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
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
      updated_at = now()
  `;
  const values = [
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
  return { text, values };
}

export async function upsertPerfil(
  empresaId: number,
  input: PerfilInput,
): Promise<void> {
  const { text, values } = buildUpsertPerfil(empresaId, input);
  await pool.query(text, values);
}
