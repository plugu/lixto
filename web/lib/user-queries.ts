// Company user list + invite flow (tables `users`, `companies`).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a
// config file, so the tsconfig "@/" alias is not resolvable in
// user-queries.test.ts.

import crypto from "node:crypto";
import { pool } from "./db";
import type { Queryable } from "./email/outbox";
import type { ApprovalStatus, Role, User } from "./types";

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

export type UserWithPending = User & { pending: boolean };

type UserRow = {
  id: string;
  company_id: string;
  email: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  job_title: string | null;
  role: Role;
  invite_token_hash: string | null;
  invite_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  pending: boolean;
};

export function buildListUsers(companyId: number): SqlQuery {
  return {
    text: `
      SELECT id, company_id, email, name, cpf, phone, job_title, role,
             invite_token_hash, invite_expires_at, created_at, updated_at,
             (password_hash IS NULL) AS pending
        FROM users
       WHERE company_id = $1
       ORDER BY name
    `,
    values: [companyId],
  };
}

export async function listUsers(
  companyId: number,
): Promise<UserWithPending[]> {
  const query = buildListUsers(companyId);
  const { rows } = await pool.query<UserRow>(query.text, query.values);
  return rows.map((row) => ({
    id: Number(row.id),
    company_id: Number(row.company_id),
    email: row.email,
    name: row.name,
    cpf: row.cpf,
    phone: row.phone,
    job_title: row.job_title,
    role: row.role,
    invite_token_hash: row.invite_token_hash,
    invite_expires_at: row.invite_expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pending: row.pending,
  }));
}

export type NewInvite = {
  email: string;
  name: string;
  role: Role;
};

/** Invoked inside the transaction, after the insert and before COMMIT — the
 * hook that lets a caller enqueue the invite mail atomically with the row
 * that justifies it (ADR 002 D1), using the real persisted `invite_expires_at`
 * rather than a value re-derived in the caller. A throwing hook rolls back
 * the invite. */
export type OnInviteCommitted = (ctx: {
  client: Queryable;
  userId: number;
  token: string;
  expiresAt: Date;
}) => Promise<void>;

/** Creates a pending user row (password_hash NULL) and returns the raw
 * (un-hashed) invite token — only the sha256 hash is stored. */
export async function createInvite(
  companyId: number,
  { email, name, role }: NewInvite,
  onCommitted?: OnInviteCommitted,
): Promise<{ token: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{
      id: string;
      invite_expires_at: Date;
    }>(
      `INSERT INTO users
         (company_id, email, name, role, invite_token_hash, invite_expires_at, password_hash)
       VALUES ($1, $2, $3, $4, $5, now() + interval '7 days', NULL)
       RETURNING id, invite_expires_at`,
      [companyId, email.trim().toLowerCase(), name, role, tokenHash],
    );
    const userId = Number(rows[0].id);
    const expiresAt = rows[0].invite_expires_at;

    if (onCommitted) {
      await onCommitted({ client, userId, token, expiresAt });
    }

    await client.query("COMMIT");
    return { token };
  } catch (err) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      throw new Error("E-mail já cadastrado.");
    }
    throw err;
  } finally {
    client.release();
  }
}

export type InviteInfo = {
  id: number;
  name: string;
  email: string;
  companyLegalName: string;
};

/** Resolves a raw invite token to the pending invite, or null when the token
 * doesn't match, is expired, or has already been accepted. */
export async function getInvite(token: string): Promise<InviteInfo | null> {
  const tokenHash = hashToken(token);
  const { rows } = await pool.query<{
    id: string;
    name: string;
    email: string;
    legal_name: string;
  }>(
    `SELECT u.id, u.name, u.email, c.legal_name
       FROM users u
       JOIN companies c ON c.id = u.company_id
      WHERE u.invite_token_hash = $1
        AND u.invite_expires_at > now()
        AND u.password_hash IS NULL`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    companyLegalName: row.legal_name,
  };
}

export type AcceptInvite = {
  name: string;
  passwordHash: string;
  cpf?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
};

export function buildAcceptInvite(
  tokenHash: string,
  data: AcceptInvite,
): SqlQuery {
  return {
    text: `
      UPDATE users
         SET password_hash = $1,
             name = $2,
             cpf = $3,
             phone = $4,
             job_title = $5,
             invite_token_hash = NULL,
             invite_expires_at = NULL,
             updated_at = now()
       WHERE invite_token_hash = $6
         AND invite_expires_at > now()
         AND password_hash IS NULL
      RETURNING id
    `,
    values: [
      data.passwordHash,
      data.name,
      data.cpf ?? null,
      data.phone ?? null,
      data.jobTitle ?? null,
      tokenHash,
    ],
  };
}

/** Sets the password/profile on a pending invite and clears the invite
 * token. Throws when the token doesn't match, is expired, or was already
 * accepted.
 *
 * Also returns the invitee's company's `approvalStatus` (F4) via a
 * follow-up SELECT rather than folding a `companies` join into
 * `buildAcceptInvite`'s RETURNING — that UPDATE is keyed purely on the
 * invite token (no `company_id` filter, see user-queries.test.ts), and the
 * caller (`invite/[token]/actions.ts`) needs the status to decide whether
 * accepting the invite is also allowed to open a session: an invitee of an
 * already-approved company gets one; an invitee of a pending/rejected
 * company (ADR 003 §D1 — status is per company, invitees inherit it) does
 * not. */
export async function acceptInvite(
  token: string,
  data: AcceptInvite,
): Promise<{ userId: number; approvalStatus: ApprovalStatus }> {
  const tokenHash = hashToken(token);
  const query = buildAcceptInvite(tokenHash, data);
  const { rows } = await pool.query<{ id: string }>(query.text, query.values);
  const row = rows[0];
  if (!row) throw new Error("Convite inválido ou expirado.");
  const userId = Number(row.id);

  const { rows: companyRows } = await pool.query<{
    approval_status: ApprovalStatus;
  }>(
    `SELECT c.approval_status
       FROM users u
       JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1`,
    [userId],
  );
  const companyRow = companyRows[0];
  if (!companyRow) throw new Error("Empresa não encontrada.");

  return { userId, approvalStatus: companyRow.approval_status };
}

export function buildUpdateRole(
  companyId: number,
  userId: number,
  role: Role,
): SqlQuery {
  return {
    text: `
      UPDATE users
         SET role = $1, updated_at = now()
       WHERE id = $2 AND company_id = $3
    `,
    values: [role, userId, companyId],
  };
}

export function buildRemoveUser(companyId: number, userId: number): SqlQuery {
  return {
    text: `DELETE FROM users WHERE id = $1 AND company_id = $2`,
    values: [userId, companyId],
  };
}

const LAST_ADMIN_ERROR = "A empresa precisa de ao menos um administrador.";

/** Counts admins in the company other than `userId`, inside the given
 * transaction client. Used by both updateRole (demotion) and removeUser to
 * refuse leaving a company without any admin. */
async function countOtherAdmins(
  client: { query: typeof pool.query },
  companyId: number,
  userId: number,
): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM users
      WHERE company_id = $1 AND role = 'admin' AND id <> $2`,
    [companyId, userId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Changes a user's role. Refuses to demote the company's last admin. */
export async function updateRole(
  companyId: number,
  userId: number,
  role: Role,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (role !== "admin") {
      const otherAdmins = await countOtherAdmins(client, companyId, userId);
      if (otherAdmins === 0) throw new Error(LAST_ADMIN_ERROR);
    }
    const query = buildUpdateRole(companyId, userId, role);
    await client.query(query.text, query.values);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Removes a user from the company. Refuses to remove the last admin. */
export async function removeUser(
  companyId: number,
  userId: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const otherAdmins = await countOtherAdmins(client, companyId, userId);
    if (otherAdmins === 0) throw new Error(LAST_ADMIN_ERROR);
    const query = buildRemoveUser(companyId, userId);
    await client.query(query.text, query.values);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
