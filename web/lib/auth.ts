// Session auth on the lixto schema (tables `users`, `sessions`, `companies`).
// Server-only: never import this from a client component — it touches the DB
// pool and next/headers.
// No auth library: Node crypto (scrypt + sha256) is enough for email+password
// sessions, and keeping the dependency list short is a standing constraint.

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
// Relative (not "@/lib/...") on purpose: vitest runs without a config file, so
// the tsconfig "@/" alias is not resolvable in auth.test.ts.
import { pool } from "./db";
import type { ApprovalStatus, Role } from "./types";

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  /** Company role (`admin|member`). Platform-wide rights live in
   * `isSuperadmin` — the two axes are orthogonal (ADR 003 §D2). */
  role: Role;
  companyId: number;
  isSuperadmin: boolean;
};

export type SessionCompany = {
  id: number;
  legalName: string;
  tradeName: string | null;
  taxId: string;
};

/** A live session: the logged-in user plus the company they belong to.
 * Everything auth.ts hands out has both fields. */
export type Session = {
  user: SessionUser;
  company: SessionCompany;
};

export const SESSION_COOKIE = "lixto_session";

const SESSION_DAYS = 30;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60; // seconds
const SCRYPT_KEYLEN = 64;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/** Dummy `scrypt$salt$hash` string, computed once at import with a fixed
 * (never-secret) salt and an empty password — the same shape `hashPassword`
 * produces, but synchronously, since this only needs to run once at module
 * load. `login()` verifies against this when the email is unknown or the
 * account has no `password_hash` yet (pending invite), so that miss path
 * still pays for one scrypt derivation instead of returning early: an
 * attacker timing the login form otherwise learns which emails exist from
 * the *absence* of that cost (F15). */
const DUMMY_PASSWORD_HASH = (() => {
  const salt = Buffer.alloc(16, 0);
  const derived = crypto.scryptSync("", salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
})();

/** `scrypt$<saltHex>$<hashHex>` with a fresh 16-byte salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"));
  return crypto.timingSafeEqual(derived, expected);
}

function sha256hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Inserts a session row and returns the raw (un-hashed) cookie token. */
export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [sha256hex(token), userId, String(SESSION_DAYS)],
  );
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

type SessionRow = {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  is_superadmin: boolean;
  company_id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string;
  approval_status: ApprovalStatus;
};

const SESSION_SELECT = `SELECT u.id   AS user_id,
            u.name, u.email, u.role, u.is_superadmin,
            c.id   AS company_id,
            c.legal_name, c.trade_name, c.tax_id, c.approval_status
       FROM users u
       JOIN companies c ON c.id = u.company_id`;

export type SqlQuery = {
  text: string;
  values: unknown[];
};

/** The `getSession` lookup: token hash to a live session row, re-checking
 * the company's approval status on every call (ADR 003 §D3) — a rejected
 * company's sessions die on their next request instead of surviving until
 * the cookie expires. Exported (F3) so `auth.test.ts` can assert both
 * predicates without a live database. */
export function buildSessionByTokenQuery(tokenHash: string): SqlQuery {
  return {
    text: `${SESSION_SELECT}
       JOIN sessions s ON s.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND c.approval_status = 'approved'`,
    values: [tokenHash],
  };
}

function toSession(row: SessionRow): Session {
  return {
    user: {
      id: Number(row.user_id),
      name: row.name,
      email: row.email,
      role: row.role,
      companyId: Number(row.company_id),
      isSuperadmin: row.is_superadmin,
    },
    company: {
      id: Number(row.company_id),
      legalName: row.legal_name,
      tradeName: row.trade_name,
      taxId: row.tax_id,
    },
  };
}

/** Resolves the cookie to a live session, or null when missing/expired.
 * The company's approval status is re-read on every request (ADR 003 §D3):
 * rejecting a company kills its live sessions on their next request instead
 * of letting them run until the cookie expires. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const query = buildSessionByTokenQuery(sha256hex(token));
  const { rows } = await pool.query<SessionRow>(query.text, query.values);
  return rows[0] ? toSession(rows[0]) : null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.user.role !== "admin") redirect("/company");
  return session;
}

/** Platform-admin gate for `/admin/*`. 404s (rather than redirecting) so a
 * logged-in non-superadmin can't distinguish "not allowed" from "doesn't
 * exist" and no session/role state leaks via a redirect target — the
 * route's existence itself isn't secret (its href ships in the client
 * bundle for the sidebar link superadmins do see). */
export async function requireSuperadmin(): Promise<Session> {
  const session = await requireSession();
  if (!session.user.isSuperadmin) notFound();
  return session;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [
      sha256hex(token),
    ]);
  }
  await clearSessionCookie();
}

/** Outcome of a login attempt. Only `ok` carries a session; the other three
 * are the copy the login page renders. */
export type LoginResult =
  | { status: "ok"; session: Session }
  | { status: "invalid" | "pending" | "rejected" };

/** Pure decision table for a login attempt. The password verdict wins: a
 * wrong password on a pending/rejected company is reported as `invalid`, so
 * an attacker cannot use the login form to probe a company's standing. */
export function classifyLogin(
  passwordOk: boolean,
  status: ApprovalStatus,
): LoginResult["status"] {
  if (!passwordOk) return "invalid";
  return status === "approved" ? "ok" : status;
}

/** Verifies credentials and — only for an approved company — opens a session
 * and sets the cookie. */
export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password) return { status: "invalid" };

  const { rows } = await pool.query<{
    id: string;
    password_hash: string | null;
    approval_status: ApprovalStatus;
  }>(
    `SELECT u.id, u.password_hash, c.approval_status
       FROM users u
       JOIN companies c ON c.id = u.company_id
      WHERE u.email = $1`,
    [normalized],
  );
  const row = rows[0];

  // Always run verifyPassword, even for an unknown email or a NULL
  // password_hash (pending invite) — comparing against DUMMY_PASSWORD_HASH
  // pays the same scrypt cost as a real comparison, so this branch doesn't
  // return measurably faster than a real miss and leak which emails exist
  // (F15).
  const passwordOk = await verifyPassword(
    password,
    row?.password_hash ?? DUMMY_PASSWORD_HASH,
  );
  if (!row || !row.password_hash) return { status: "invalid" };

  // Password first, status second: the status is only consulted once the
  // caller has proven they own the account.
  const outcome = classifyLogin(passwordOk, row.approval_status);
  if (outcome !== "ok") return { status: outcome };

  const userId = Number(row.id);
  const token = await createSession(userId);
  await setSessionCookie(token);

  // Build the session from the user id rather than re-reading the cookie we
  // just wrote — the cookie store is request-scoped and this avoids relying on
  // read-after-write semantics inside a server action.
  const { rows: sessionRows } = await pool.query<SessionRow>(
    `${SESSION_SELECT} WHERE u.id = $1`,
    [userId],
  );
  const session = sessionRows[0];
  return session
    ? { status: "ok", session: toSession(session) }
    : { status: "invalid" };
}
