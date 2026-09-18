// Superadmin "Administração → Empresas" queries (ticket 158): list companies
// by approval status and flip a company's status, enqueuing the matching
// status mail (155) in the same transaction so the row and the mail either
// both land or neither does (ADR 002 D1, same pattern as user-queries.ts's
// createInvite).
//
// Relative imports on purpose: vitest runs without a config file, so the
// tsconfig "@/" alias is not resolvable in company-approval-queries.test.ts.

import { pool } from "./db";
import { enqueue } from "./email/outbox";
import type { ApprovalStatus } from "./types";

const APP_URL = process.env.LIXTO_APP_URL ?? "https://lixto.com.br";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

/** One row of the Empresas list: company fields plus its first admin
 * (`role='admin'`, lowest id), when one exists. A company always has at
 * least one admin at signup, but the LEFT JOIN LATERAL tolerates a company
 * whose admin was later removed. */
export type CompanyApprovalRow = {
  id: number;
  tax_id: string;
  legal_name: string;
  trade_name: string | null;
  city_name: string | null;
  state: string | null;
  created_at: Date;
  approval_reason: string | null;
  approval_changed_at: Date | null;
  admin_name: string | null;
  admin_email: string | null;
};

type CompanyApprovalDbRow = {
  id: string | number;
  tax_id: string;
  legal_name: string;
  trade_name: string | null;
  city_name: string | null;
  state: string | null;
  created_at: Date;
  approval_reason: string | null;
  approval_changed_at: Date | null;
  admin_name: string | null;
  admin_email: string | null;
};

export function buildListCompaniesByStatus(status: ApprovalStatus): SqlQuery {
  return {
    text: `
      SELECT c.id, c.tax_id, c.legal_name, c.trade_name, c.city_name, c.state,
             c.created_at, c.approval_reason, c.approval_changed_at,
             admin.name AS admin_name, admin.email AS admin_email
        FROM companies c
        LEFT JOIN LATERAL (
              SELECT name, email
                FROM users
               WHERE company_id = c.id AND role = 'admin'
               ORDER BY id
               LIMIT 1
        ) admin ON true
       WHERE c.approval_status = $1
       ORDER BY c.created_at DESC
    `,
    values: [status],
  };
}

export async function listCompaniesByStatus(
  status: ApprovalStatus,
): Promise<CompanyApprovalRow[]> {
  const query = buildListCompaniesByStatus(status);
  const { rows } = await pool.query<CompanyApprovalDbRow>(
    query.text,
    query.values,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    tax_id: row.tax_id,
    legal_name: row.legal_name,
    trade_name: row.trade_name,
    city_name: row.city_name,
    state: row.state,
    created_at: row.created_at,
    approval_reason: row.approval_reason,
    approval_changed_at: row.approval_changed_at,
    admin_name: row.admin_name,
    admin_email: row.admin_email,
  }));
}

export function buildSetApprovalStatus(
  companyId: number,
  status: ApprovalStatus,
  reason: string | null,
  changedByUserId: number,
): SqlQuery {
  return {
    text: `
      UPDATE companies
         SET approval_status = $2,
             approval_reason = $3,
             approval_changed_at = now(),
             approval_changed_by = $4,
             updated_at = now()
       WHERE id = $1
      RETURNING legal_name, trade_name
    `,
    values: [companyId, status, reason, changedByUserId],
  };
}

/** Companies awaiting a first look — the Pendentes tab badge. */
export function countPendingCompanies(): Promise<number> {
  return pool
    .query<{ count: string }>(
      `SELECT count(*)::text AS count FROM companies WHERE approval_status = 'pending'`,
    )
    .then(({ rows }) => Number(rows[0]?.count ?? 0));
}

/**
 * Approves or rejects a company: updates `approval_status` and enqueues the
 * matching mail to the company's first admin, in one transaction (ADR 002
 * D1) — a rejected enqueue rolls the status change back rather than leaving
 * a company whose status changed with nobody told.
 *
 * Idempotent on purpose, not by accident: re-applying the *same* status
 * (e.g. clicking Aprovar again on an already-approved company) still runs
 * the update and still enqueues the mail. A superadmin who wants to resend
 * "acesso liberado" — the applicant says they never got it — does so by
 * reapplying the status, not through a separate "resend" affordance.
 */
export async function setApprovalStatus(
  companyId: number,
  status: ApprovalStatus,
  reason: string | null,
  changedByUserId: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updateQuery = buildSetApprovalStatus(
      companyId,
      status,
      reason,
      changedByUserId,
    );
    const { rows: companyRows } = await client.query<{
      legal_name: string;
      trade_name: string | null;
    }>(updateQuery.text, updateQuery.values);
    const company = companyRows[0];
    if (!company) throw new Error("Empresa não encontrada.");
    const companyName = company.trade_name ?? company.legal_name;

    const { rows: adminRows } = await client.query<{
      id: string | number;
      name: string;
      email: string;
    }>(
      `SELECT id, name, email
         FROM users
        WHERE company_id = $1 AND role = 'admin'
        ORDER BY id
        LIMIT 1`,
      [companyId],
    );
    const admin = adminRows[0];

    if (admin) {
      const adminId = Number(admin.id);
      if (status === "approved") {
        await enqueue(
          {
            toEmail: admin.email,
            template: "signup_approved",
            payload: {
              userName: admin.name,
              companyName,
              loginUrl: `${APP_URL}/login`,
            },
            companyId,
            userId: adminId,
          },
          client,
        );
      } else if (status === "rejected") {
        await enqueue(
          {
            toEmail: admin.email,
            template: "signup_rejected",
            payload: { userName: admin.name, companyName, reason },
            companyId,
            userId: adminId,
          },
          client,
        );
      }
      // status === "pending": nothing to mail — the initial signup already
      // sent signup_received, and a superadmin cannot set this status from
      // the admin page (only approve/reject actions exist).
    }

    await client.query("COMMIT");
  } catch (err) {
    // ROLLBACK in its own try/catch (F2/F16): if it also fails — the
    // connection is already broken, e.g. the error that got us here was a
    // dropped connection — we still need to release *with an error* so
    // node-postgres discards the client instead of returning a poisoned
    // connection to the pool for the next caller. The original `err` is
    // what the caller needs, so a failed rollback is swallowed, not thrown.
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignored on purpose — see comment above.
    }
    client.release(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
  client.release();
}
