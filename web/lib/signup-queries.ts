// Signup transaction: creates an empresa, its CNAEs and the first admin
// usuario atomically (ticket 25). Query builders are exported separately so
// the SQL shape is unit-testable without a DB (pattern from ./queries.ts).
//
// Relative imports on purpose: vitest runs without a config file, so the
// tsconfig "@/" alias is not resolvable in signup-queries.test.ts.
import { onlyDigits } from "./br-validators";
import { pool } from "./db";
import type { Porte } from "./tenant-types";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

export type SignupCnae = {
  codigo: string;
  descricao: string;
  principal: boolean;
};

export type SignupEmpresaInput = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  naturezaJuridica: string | null;
  porte: Porte | null;
  optanteSimples: boolean;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
};

export type SignupUsuarioInput = {
  nome: string;
  email: string;
  senhaHash: string;
  cpf: string | null;
  telefone: string | null;
  cargo: string | null;
};

export type SignupInput = {
  empresa: SignupEmpresaInput;
  cnaes: SignupCnae[];
  usuario: SignupUsuarioInput;
};

export type SignupResult = {
  empresaId: number;
  usuarioId: number;
};

/** Builds the empresa INSERT. All string identifiers (cnpj, cep) are
 * normalized to digits-only before binding. */
export function buildInsertEmpresa(input: SignupEmpresaInput): SqlQuery {
  return {
    text: `INSERT INTO empresa (
        cnpj, razao_social, nome_fantasia, natureza_juridica, porte,
        optante_simples, inscricao_estadual, inscricao_municipal,
        cep, logradouro, numero, complemento, bairro, municipio, uf,
        telefone, email
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id`,
    values: [
      onlyDigits(input.cnpj),
      input.razaoSocial,
      input.nomeFantasia,
      input.naturezaJuridica,
      input.porte,
      input.optanteSimples,
      input.inscricaoEstadual,
      input.inscricaoMunicipal,
      input.cep ? onlyDigits(input.cep) : null,
      input.logradouro,
      input.numero,
      input.complemento,
      input.bairro,
      input.municipio,
      input.uf,
      input.telefone,
      input.email ? input.email.trim().toLowerCase() : null,
    ],
  };
}

/** Builds a single multi-row CNAE INSERT for the given empresa. Values are
 * flattened in row order (codigo, descricao, principal) x N. */
export function buildInsertCnaes(
  empresaId: number,
  cnaes: SignupCnae[],
): SqlQuery {
  const values: unknown[] = [empresaId];
  const rows = cnaes.map((cnae, i) => {
    const base = 1 + i * 3;
    values.push(
      onlyDigits(cnae.codigo).padStart(7, "0"),
      cnae.descricao,
      cnae.principal,
    );
    return `($1, $${base + 1}, $${base + 2}, $${base + 3})`;
  });

  return {
    text: `INSERT INTO empresa_cnae (empresa_id, codigo, descricao, principal)
      VALUES ${rows.join(", ")}`,
    values,
  };
}

/** Builds the admin usuario INSERT for the empresa created above. Email is
 * lowercased to match the unique index / login lookup convention. */
export function buildInsertUsuario(
  empresaId: number,
  input: SignupUsuarioInput,
): SqlQuery {
  return {
    text: `INSERT INTO usuario (
        empresa_id, email, senha_hash, nome, cpf, telefone, cargo, role
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin')
      RETURNING id`,
    values: [
      empresaId,
      input.email.trim().toLowerCase(),
      input.senhaHash,
      input.nome,
      input.cpf ? onlyDigits(input.cpf) : null,
      input.telefone,
      input.cargo,
    ],
  };
}

/** Creates the empresa + CNAEs + first admin usuario in a single
 * transaction. Rolls back on any error (e.g. unique violation on cnpj or
 * usuario.email — surfaced to the caller as a pg error with code 23505). */
export async function createEmpresaComAdmin(
  input: SignupInput,
): Promise<SignupResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const empresaQuery = buildInsertEmpresa(input.empresa);
    const empresaResult = await client.query<{ id: string }>(
      empresaQuery.text,
      empresaQuery.values,
    );
    const empresaId = Number(empresaResult.rows[0].id);

    if (input.cnaes.length > 0) {
      const cnaesQuery = buildInsertCnaes(empresaId, input.cnaes);
      await client.query(cnaesQuery.text, cnaesQuery.values);
    }

    const usuarioQuery = buildInsertUsuario(empresaId, input.usuario);
    const usuarioResult = await client.query<{ id: string }>(
      usuarioQuery.text,
      usuarioQuery.values,
    );
    const usuarioId = Number(usuarioResult.rows[0].id);

    await client.query("COMMIT");
    return { empresaId, usuarioId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
