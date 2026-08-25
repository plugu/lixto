// Session auth on the lixto schema (tables `users`, `sessions`, `companies`).
// Server-only: never import this from a client component — it touches the DB
// pool and next/headers.
// No auth library: Node crypto (scrypt + sha256) is enough for email+password
// sessions, and keeping the dependency list short is a standing constraint.

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
// Relative (not "@/lib/...") on purpose: vitest runs without a config file, so
// the tsconfig "@/" alias is not resolvable in auth.test.ts.
import { pool } from "./db";
import type { Role } from "./types";

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  companyId: number;
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
  company_id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string;
};

const SESSION_SELECT = `SELECT u.id   AS user_id,
            u.name, u.email, u.role,
            c.id   AS company_id,
            c.legal_name, c.trade_name, c.tax_id
       FROM users u
       JOIN companies c ON c.id = u.company_id`;

function toSession(row: SessionRow): Session {
  return {
    user: {
      id: Number(row.user_id),
      name: row.name,
      email: row.email,
      role: row.role,
      companyId: Number(row.company_id),
    },
    company: {
      id: Number(row.company_id),
      legalName: row.legal_name,
      tradeName: row.trade_name,
      taxId: row.tax_id,
    },
  };
}

/** Resolves the cookie to a live session, or null when missing/expired. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { rows } = await pool.query<SessionRow>(
    `${SESSION_SELECT}
       JOIN sessions s ON s.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256hex(token)],
  );
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

/** Verifies credentials, opens a session and sets the cookie. */
export async function login(
  email: string,
  password: string,
): Promise<Session | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password) return null;

  const { rows } = await pool.query<{
    id: string;
    password_hash: string | null;
  }>(`SELECT id, password_hash FROM users WHERE email = $1`, [normalized]);
  const row = rows[0];
  if (!row || !row.password_hash) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;

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
  return sessionRows[0] ? toSession(sessionRows[0]) : null;
}
