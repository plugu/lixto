// Queries for the /empresa profile page (ticket 26). Every function takes
// `empresaId` explicitly and callers must always source it from the session
// (never from a form field or URL param) — the tenant rule for this cycle.

import { pool } from "./db";
import { onlyDigits } from "./br-validators";
import type { Empresa, EmpresaCnae, Porte } from "./tenant-types";

export type EmpresaInput = {
  razaoSocial: string;
  nomeFantasia: string;
  naturezaJuridica: string;
  porte: string;
  optanteSimples: boolean;
  inscricaoEstadual: string;
  inscricaoMunicipal: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  telefone: string;
  email: string;
};

export type CnaeInput = {
  codigo: string;
  descricao: string;
  principal: boolean;
};

export type SqlQuery = {
  text: string;
  values: unknown[];
};

/** Empty string → null (most empresa fields are optional). */
function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizePorte(value: string): Porte | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : (trimmed as Porte);
}

export async function getEmpresa(empresaId: number): Promise<Empresa | null> {
  const { rows } = await pool.query<Empresa>(
    `SELECT id, cnpj, razao_social, nome_fantasia, natureza_juridica, porte,
            optante_simples, inscricao_estadual, inscricao_municipal,
            cep, logradouro, numero, complemento, bairro, municipio, uf,
            telefone, email, created_at, updated_at
       FROM empresa
      WHERE id = $1`,
    [empresaId],
  );
  return rows[0] ?? null;
}

export async function getCnaes(empresaId: number): Promise<EmpresaCnae[]> {
  const { rows } = await pool.query<EmpresaCnae>(
    `SELECT id, empresa_id, codigo, descricao, principal
       FROM empresa_cnae
      WHERE empresa_id = $1
      ORDER BY principal DESC, codigo ASC`,
    [empresaId],
  );
  return rows;
}

/** Builds the empresa UPDATE. `empresaId` is always $1. */
export function buildUpdateEmpresa(
  empresaId: number,
  input: EmpresaInput,
): SqlQuery {
  const text = `
    UPDATE empresa
       SET razao_social = $2,
           nome_fantasia = $3,
           natureza_juridica = $4,
           porte = $5,
           optante_simples = $6,
           inscricao_estadual = $7,
           inscricao_municipal = $8,
           cep = $9,
           logradouro = $10,
           numero = $11,
           complemento = $12,
           bairro = $13,
           municipio = $14,
           uf = $15,
           telefone = $16,
           email = $17,
           updated_at = now()
     WHERE id = $1
  `;
  const values = [
    empresaId,
    input.razaoSocial.trim(),
    nullIfEmpty(input.nomeFantasia),
    nullIfEmpty(input.naturezaJuridica),
    normalizePorte(input.porte),
    input.optanteSimples,
    nullIfEmpty(input.inscricaoEstadual),
    nullIfEmpty(input.inscricaoMunicipal),
    input.cep.trim() === "" ? null : onlyDigits(input.cep),
    nullIfEmpty(input.logradouro),
    nullIfEmpty(input.numero),
    nullIfEmpty(input.complemento),
    nullIfEmpty(input.bairro),
    nullIfEmpty(input.municipio),
    input.uf.trim() === "" ? null : input.uf.trim().toUpperCase(),
    nullIfEmpty(input.telefone),
    nullIfEmpty(input.email),
  ];
  return { text, values };
}

export async function updateEmpresa(
  empresaId: number,
  input: EmpresaInput,
): Promise<void> {
  const { text, values } = buildUpdateEmpresa(empresaId, input);
  await pool.query(text, values);
}

/** Throws when the CNAE list has zero or more than one `principal`. */
export function validateCnaes(cnaes: CnaeInput[]): void {
  const principalCount = cnaes.filter((c) => c.principal).length;
  if (principalCount !== 1) {
    throw new Error("Selecione exatamente um CNAE principal.");
  }
}

/** Builds the multi-row CNAE insert. `empresaId` is always $1. Assumes
 * `cnaes` is non-empty — callers should skip the insert (after the delete)
 * when the list is empty. */
export function buildInsertCnaes(
  empresaId: number,
  cnaes: CnaeInput[],
): SqlQuery {
  const values: unknown[] = [empresaId];
  const rows = cnaes.map((c) => {
    const codigoIdx = values.push(onlyDigits(c.codigo));
    const descricaoIdx = values.push(c.descricao.trim());
    const principalIdx = values.push(c.principal);
    return `($1, $${codigoIdx}, $${descricaoIdx}, $${principalIdx})`;
  });
  const text = `
    INSERT INTO empresa_cnae (empresa_id, codigo, descricao, principal)
    VALUES ${rows.join(", ")}
  `;
  return { text, values };
}

/** Replaces the empresa's CNAE list inside a transaction: delete all, then
 * insert the given rows (validated to have exactly one principal). */
export async function replaceCnaes(
  empresaId: number,
  cnaes: CnaeInput[],
): Promise<void> {
  validateCnaes(cnaes);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM empresa_cnae WHERE empresa_id = $1`, [
      empresaId,
    ]);
    const { text, values } = buildInsertCnaes(empresaId, cnaes);
    await client.query(text, values);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
