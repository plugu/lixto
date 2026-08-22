// Empresa user list + invite flow (ticket 27).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a
// config file, so the tsconfig "@/" alias is not resolvable in
// usuario-queries.test.ts.

import crypto from "node:crypto";
import { pool } from "./db";
import type { Role, Usuario } from "./tenant-types";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

/** sha256 hex of an invite/session-style token. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

export type UsuarioComPendente = Usuario & { pendente: boolean };

type UsuarioRow = {
  id: string;
  empresa_id: string;
  email: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  cargo: string | null;
  role: Role;
  convite_token_hash: string | null;
  convite_expira_em: Date | null;
  created_at: Date;
  updated_at: Date;
  pendente: boolean;
};

export function buildListUsuarios(empresaId: number): SqlQuery {
  return {
    text: `
      SELECT id, empresa_id, email, nome, cpf, telefone, cargo, role,
             convite_token_hash, convite_expira_em, created_at, updated_at,
             (senha_hash IS NULL) AS pendente
        FROM usuario
       WHERE empresa_id = $1
       ORDER BY nome
    `,
    values: [empresaId],
  };
}

export async function listUsuarios(
  empresaId: number,
): Promise<UsuarioComPendente[]> {
  const query = buildListUsuarios(empresaId);
  const { rows } = await pool.query<UsuarioRow>(query.text, query.values);
  return rows.map((row) => ({
    id: Number(row.id),
    empresa_id: Number(row.empresa_id),
    email: row.email,
    nome: row.nome,
    cpf: row.cpf,
    telefone: row.telefone,
    cargo: row.cargo,
    role: row.role,
    convite_token_hash: row.convite_token_hash,
    convite_expira_em: row.convite_expira_em,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pendente: row.pendente,
  }));
}

export type NovoConvite = {
  email: string;
  nome: string;
  role: Role;
};

/** Creates a pending usuario row (senha_hash NULL) and returns the raw
 * (un-hashed) invite token — only the sha256 hash is stored. */
export async function createConvite(
  empresaId: number,
  { email, nome, role }: NovoConvite,
): Promise<{ token: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  try {
    await pool.query(
      `INSERT INTO usuario
         (empresa_id, email, nome, role, convite_token_hash, convite_expira_em, senha_hash)
       VALUES ($1, $2, $3, $4, $5, now() + interval '7 days', NULL)`,
      [empresaId, email.trim().toLowerCase(), nome, role, tokenHash],
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error("E-mail já cadastrado.");
    }
    throw err;
  }

  return { token };
}

export type ConviteInfo = {
  id: number;
  nome: string;
  email: string;
  empresaRazaoSocial: string;
};

/** Resolves a raw invite token to the pending invite, or null when the token
 * doesn't match, is expired, or has already been accepted. */
export async function getConvite(token: string): Promise<ConviteInfo | null> {
  const tokenHash = hashToken(token);
  const { rows } = await pool.query<{
    id: string;
    nome: string;
    email: string;
    razao_social: string;
  }>(
    `SELECT u.id, u.nome, u.email, e.razao_social
       FROM usuario u
       JOIN empresa e ON e.id = u.empresa_id
      WHERE u.convite_token_hash = $1
        AND u.convite_expira_em > now()
        AND u.senha_hash IS NULL`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    nome: row.nome,
    email: row.email,
    empresaRazaoSocial: row.razao_social,
  };
}

export type AceiteConvite = {
  nome: string;
  senhaHash: string;
  cpf?: string | null;
  telefone?: string | null;
  cargo?: string | null;
};

export function buildAcceptConvite(
  tokenHash: string,
  data: AceiteConvite,
): SqlQuery {
  return {
    text: `
      UPDATE usuario
         SET senha_hash = $1,
             nome = $2,
             cpf = $3,
             telefone = $4,
             cargo = $5,
             convite_token_hash = NULL,
             convite_expira_em = NULL,
             updated_at = now()
       WHERE convite_token_hash = $6
         AND convite_expira_em > now()
         AND senha_hash IS NULL
      RETURNING id
    `,
    values: [
      data.senhaHash,
      data.nome,
      data.cpf ?? null,
      data.telefone ?? null,
      data.cargo ?? null,
      tokenHash,
    ],
  };
}

/** Sets the password/profile on a pending invite and clears the invite
 * token. Throws when the token doesn't match, is expired, or was already
 * accepted. */
export async function acceptConvite(
  token: string,
  data: AceiteConvite,
): Promise<{ usuarioId: number }> {
  const tokenHash = hashToken(token);
  const query = buildAcceptConvite(tokenHash, data);
  const { rows } = await pool.query<{ id: string }>(query.text, query.values);
  const row = rows[0];
  if (!row) throw new Error("Convite inválido ou expirado.");
  return { usuarioId: Number(row.id) };
}

export function buildUpdateRole(
  empresaId: number,
  usuarioId: number,
  role: Role,
): SqlQuery {
  return {
    text: `
      UPDATE usuario
         SET role = $1, updated_at = now()
       WHERE id = $2 AND empresa_id = $3
    `,
    values: [role, usuarioId, empresaId],
  };
}

export function buildRemoveUsuario(
  empresaId: number,
  usuarioId: number,
): SqlQuery {
  return {
    text: `DELETE FROM usuario WHERE id = $1 AND empresa_id = $2`,
    values: [usuarioId, empresaId],
  };
}

const LAST_ADMIN_ERROR = "A empresa precisa de ao menos um administrador.";

/** Counts admins in the empresa other than `usuarioId`, inside the given
 * transaction client. Used by both updateRole (demotion) and removeUsuario
 * to refuse leaving an empresa without any admin. */
async function countOtherAdmins(
  client: { query: typeof pool.query },
  empresaId: number,
  usuarioId: number,
): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM usuario
      WHERE empresa_id = $1 AND role = 'admin' AND id <> $2`,
    [empresaId, usuarioId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Changes a user's role. Refuses to demote the empresa's last admin. */
export async function updateRole(
  empresaId: number,
  usuarioId: number,
  role: Role,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (role !== "admin") {
      const otherAdmins = await countOtherAdmins(client, empresaId, usuarioId);
      if (otherAdmins === 0) throw new Error(LAST_ADMIN_ERROR);
    }
    const query = buildUpdateRole(empresaId, usuarioId, role);
    await client.query(query.text, query.values);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Removes a user from the empresa. Refuses to remove the last admin. */
export async function removeUsuario(
  empresaId: number,
  usuarioId: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const otherAdmins = await countOtherAdmins(client, empresaId, usuarioId);
    if (otherAdmins === 0) throw new Error(LAST_ADMIN_ERROR);
    const query = buildRemoveUsuario(empresaId, usuarioId);
    await client.query(query.text, query.values);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
