// The daily-digest half of the mail dispatch (PRODUCT §6): one
// `daily_digest` outbox row per company admin, built from the same
// `getDigest` the in-app banner reads, so email and UI never disagree.
//
// Runs inside the web process, triggered by the token-guarded internal route
// (app/api/internal/email/digest) — the CLI (ticket 113) only pokes that
// route (`lixto email digest`).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { pool } from "../db";
import { getDigest } from "../digest-queries";
import { enqueue } from "./outbox";
import { buildUnsubscribeUrl } from "./unsubscribe";
import type { DigestAttentionItem, TemplatePayloads } from "./templates";

const APP_URL = process.env.LIXTO_APP_URL ?? "https://lixto.com.br";

export type DigestBatchResult = {
  companies: number;
  enqueued: number;
  skipped: number;
};

type Recipient = { companyId: number; companyName: string; email: string };

type CompanyRecipients = { companyName: string; emails: string[] };

/**
 * Every admin whose company qualifies: `companyId` given → just that company
 * (no existence check — a bad id simply yields zero rows and the batch is a
 * no-op); otherwise every company with at least one admin user. `email` is
 * `NOT NULL` on `users`, so "has an admin" already implies "has an admin with
 * an email" — no extra predicate needed.
 */
async function listRecipients(companyId?: number): Promise<Recipient[]> {
  const { rows } = await pool.query<{
    company_id: string | number;
    company_name: string;
    email: string;
  }>(
    `SELECT c.id AS company_id,
            COALESCE(NULLIF(c.trade_name, ''), c.legal_name) AS company_name,
            u.email
       FROM companies c
       JOIN users u ON u.company_id = c.id AND u.role = 'admin'
      WHERE ($1::bigint IS NULL OR c.id = $1)
      ORDER BY c.id, u.id`,
    [companyId ?? null],
  );
  return rows.map((row) => ({
    companyId: Number(row.company_id),
    companyName: row.company_name,
    email: row.email,
  }));
}

function groupByCompany(recipients: Recipient[]): Map<number, CompanyRecipients> {
  const byCompany = new Map<number, CompanyRecipients>();
  for (const recipient of recipients) {
    const existing = byCompany.get(recipient.companyId);
    if (existing) {
      existing.emails.push(recipient.email);
    } else {
      byCompany.set(recipient.companyId, {
        companyName: recipient.companyName,
        emails: [recipient.email],
      });
    }
  }
  return byCompany;
}

const SAO_PAULO_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
});

/** `YYYY-MM-DD` in the São Paulo civil day — one digest per company per
 * calendar day *there*, not wherever/whenever the worker/CLI happens to run.
 * The schedule (`30 8 * * *` America/Sao_Paulo) sits close enough to
 * midnight UTC that keying on UTC would give a run between 21:00 and 24:00
 * BRT tomorrow's date, so the next morning's run keys a different day and
 * sends a second digest for the same São Paulo day. */
function today(): string {
  return SAO_PAULO_DATE_FORMAT.format(new Date());
}

/** Keyed on the recipient too: without the email, every admin of a company
 * collides on the same key and only the first `enqueue` call survives the
 * partial unique index (migration 003) — the rest come back
 * `skipped: "duplicate"` and their admin never gets mail. */
function dedupeKey(companyId: number, email: string): string {
  return `daily_digest:${companyId}:${email}:${today()}`;
}

function attentionCard(row: {
  source_id: string;
  description: string | null;
  agency_name: string | null;
  state_uf: string | null;
  score: number;
  proposal_closes_at: Date | null;
}): DigestAttentionItem {
  return {
    sourceId: row.source_id,
    description: row.description ?? "",
    agency: row.agency_name,
    state: row.state_uf,
    score: row.score,
    closesAt: row.proposal_closes_at ? row.proposal_closes_at.toISOString() : null,
    url: `${APP_URL}/procurement/${row.source_id}`,
  };
}

/**
 * Enqueues today's digest for every qualifying company, one row per admin
 * email. A company whose digest is empty (`attentionCount === 0 &&
 * matchedCount === 0`) is skipped outright — an empty digest is worse than no
 * mail. The per-recipient, per-day `dedupeKey` makes a repeat run of the same
 * São Paulo day a no-op at the outbox layer (ON CONFLICT DO NOTHING) without
 * dropping any admin's copy, so this function is safe to re-trigger.
 */
export async function runDigestBatch(
  opts: { companyId?: number } = {},
): Promise<DigestBatchResult> {
  const byCompany = groupByCompany(await listRecipients(opts.companyId));

  let enqueued = 0;
  let skipped = 0;

  for (const [companyId, { companyName, emails }] of byCompany) {
    const digest = await getDigest(companyId);

    if (digest.attentionCount === 0 && digest.matchedCount === 0) {
      skipped += 1;
      continue;
    }

    const attention = digest.attention.map(attentionCard);

    for (const email of emails) {
      const payload: TemplatePayloads["daily_digest"] = {
        companyName,
        appUrl: `${APP_URL}/opportunities`,
        unsubscribeUrl: buildUnsubscribeUrl(email),
        newCount: digest.newCount,
        matchedCount: digest.matchedCount,
        attentionCount: digest.attentionCount,
        attention,
      };

      const result = await enqueue({
        toEmail: email,
        template: "daily_digest",
        payload,
        companyId,
        dedupeKey: dedupeKey(companyId, email),
      });
      if (result.id !== null) enqueued += 1;
    }
  }

  return { companies: byCompany.size, enqueued, skipped };
}
