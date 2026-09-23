// The transactional email outbox: enqueue → claim → settle, on the
// `email_messages` / `email_suppressions` tables of migration 003.
//
// Nothing here talks SMTP (ticket 111) or renders anything (ticket 110). This
// module is the only place that writes the queue, and every value from the
// outside world is bound as $n — never interpolated into SQL.
//
// Three invariants shape the API:
//   1. `enqueue(input, client)` accepts a caller's transaction client, so mail
//      is written in the same transaction as the business event (signup,
//      invite). Either both land or neither does. Its suppression test lives
//      inside the INSERT, so an unsubscribe can never slip in between.
//   2. `claimBatch` flips rows to 'sending' with FOR UPDATE SKIP LOCKED, so two
//      workers on the same schedule never take the same message.
//   3. Every 'sending' row is eventually settled: whatever the worker fails to
//      finish, `requeueStale` returns to the queue (or fails for good). No
//      message is stranded by a crash.
//
// See docs/adr/002-transactional-email.md.

import type { QueryResult, QueryResultRow } from "pg";

import { pool } from "../db";

export type EmailTemplate =
  | "welcome"
  | "invite"
  | "password_reset"
  | "daily_digest"
  | "signup_received"
  | "signup_pending_admin"
  | "signup_approved"
  | "signup_rejected"
  | "case_ready";

export type EmailStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "suppressed";

export type SuppressionReason =
  | "hard_bounce"
  | "complaint"
  | "unsubscribe"
  | "manual";

/** `pool` or a `PoolClient` inside someone else's transaction. Declared
 * structurally so tests can pass `{ query: vi.fn() }`. */
export type Queryable = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export type EnqueueInput = {
  toEmail: string;
  template: EmailTemplate;
  /** Render variables for ticket 110; stored verbatim as JSONB. */
  payload?: Record<string, unknown>;
  companyId?: number | null;
  userId?: number | null;
  /** Unique while non-null: a repeat is dropped, not inserted. */
  dedupeKey?: string | null;
  /** Defaults to now() — i.e. the next worker pass. */
  scheduledFor?: Date | null;
};

/** A skip is not an error: the row simply does not exist. Callers that care
 * branch on `skipped`; the rest ignore the result. */
export type EnqueueResult =
  | { id: number; skipped?: undefined }
  | { id: null; skipped: "suppressed" | "duplicate" };

/** One outbox row. Column names are the SQL ones (as in the other query
 * modules); BIGINT/INTEGER columns are normalized to numbers because pg hands
 * bigints back as strings. */
export type EmailMessage = {
  id: number;
  to_email: string;
  company_id: number | null;
  user_id: number | null;
  template: EmailTemplate;
  payload: Record<string, unknown>;
  subject: string | null;
  status: EmailStatus;
  attempts: number;
  last_error: string | null;
  message_id: string | null;
  dedupe_key: string | null;
  scheduled_for: Date;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type EmailStats = {
  queued: number;
  /** In flight right now. A number that only grows means stranded rows —
   * `requeueStale` is what brings them back. */
  sending: number;
  sent24h: number;
  failed24h: number;
  suppressed: number;
};

/** What `requeueStale` did: rows put back in the queue, and rows that had
 * already burned every attempt and are now terminally `failed`. */
export type RequeueStaleResult = {
  requeued: number;
  failed: number;
};

/** Minutes to wait before attempt n+1, indexed by the attempt that just
 * failed (1 → 1 min, 2 → 5 min, 3 → 30 min, 4 → 2 h). */
export const BACKOFF_MINUTES = [1, 5, 30, 120] as const;

/** After this many attempts a message is `failed` for good. */
export const MAX_ATTEMPTS = 5;

/** How long a row may sit in 'sending' before we assume its runner died. The
 * worker's own ceiling is `maxDuration = 300` s, so anything older than this
 * cannot still be in flight. */
export const STALE_SENDING_MINUTES = 15;

/** Addresses are compared case-insensitively everywhere (suppressions are
 * keyed by the lowercased address), so normalize once at the boundary. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Backoff for the attempt that just failed (`attempts` is already incremented
 * by `claimBatch`). `null` means "no attempt left" — give up and mark failed.
 */
export function nextRetryMinutes(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return BACKOFF_MINUTES[attempts - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
}

const MESSAGE_COLUMNS = `id, to_email, company_id, user_id, template, payload,
    subject, status, attempts, last_error, message_id, dedupe_key,
    scheduled_for, sent_at, created_at, updated_at`;

type RawMessage = Omit<
  EmailMessage,
  "id" | "company_id" | "user_id" | "attempts"
> & {
  id: string | number;
  company_id: string | number | null;
  user_id: string | number | null;
  attempts: string | number;
};

function toNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function mapMessage(row: RawMessage): EmailMessage {
  return {
    ...row,
    id: Number(row.id),
    company_id: toNumber(row.company_id),
    user_id: toNumber(row.user_id),
    attempts: Number(row.attempts),
  };
}

/** True when the address must not be mailed at all (hard bounce, complaint,
 * manual block) or opted out of digests. Callers pass an already-normalized
 * address or a raw one; this normalizes either way. */
export async function isSuppressed(
  email: string,
  client: Queryable = pool,
): Promise<boolean> {
  const { rows } = await client.query<{ email: string }>(
    `SELECT email FROM email_suppressions WHERE email = $1`,
    [normalizeEmail(email)],
  );
  return rows.length > 0;
}

/**
 * Queues one message. Pass `client` to write it inside the caller's
 * transaction — the whole point of the outbox.
 *
 * Two silent skips, both by design: a suppressed address and a repeated
 * `dedupeKey`. Both are decided by *one* statement, because a separate
 * "is it suppressed?" SELECT could be overtaken by an unsubscribe committing
 * between the read and the INSERT, leaving a deliverable row for an address
 * that just opted out. `SELECT ... WHERE NOT EXISTS` re-evaluates the
 * suppression inside the insert itself; `ON CONFLICT ... DO NOTHING` repeats
 * the partial index's predicate so Postgres can infer that index.
 *
 * Which of the two skips happened is only interesting when nothing was
 * inserted, so the suppression lookup runs then and only then.
 */
export async function enqueue(
  input: EnqueueInput,
  client: Queryable = pool,
): Promise<EnqueueResult> {
  const toEmail = normalizeEmail(input.toEmail);

  const { rows } = await client.query<{ id: string | number }>(
    `INSERT INTO email_messages
         (to_email, company_id, user_id, template, payload, dedupe_key, scheduled_for)
     SELECT $1::text, $2::bigint, $3::bigint, $4::text, $5::jsonb, $6::text,
            COALESCE($7::timestamptz, now())
      WHERE NOT EXISTS (
            SELECT 1 FROM email_suppressions WHERE email = $1::text
      )
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      toEmail,
      input.companyId ?? null,
      input.userId ?? null,
      input.template,
      JSON.stringify(input.payload ?? {}),
      input.dedupeKey ?? null,
      input.scheduledFor ?? null,
    ],
  );

  if (rows.length === 0) {
    const suppressed = await isSuppressed(toEmail, client);
    return { id: null, skipped: suppressed ? "suppressed" : "duplicate" };
  }
  return { id: Number(rows[0].id) };
}

/**
 * Takes up to `limit` due messages for this runner: one statement flips them
 * to 'sending' and counts the attempt. `FOR UPDATE SKIP LOCKED` is what makes
 * overlapping worker runs safe — a row locked by another transaction is
 * skipped, not waited on.
 */
export async function claimBatch(
  limit: number,
  client: Queryable = pool,
): Promise<EmailMessage[]> {
  const { rows } = await client.query<RawMessage>(
    `UPDATE email_messages
        SET status = 'sending',
            attempts = attempts + 1,
            updated_at = now()
      WHERE id IN (
            SELECT id
              FROM email_messages
             WHERE status = 'queued'
               AND scheduled_for <= now()
             ORDER BY scheduled_for
             LIMIT $1
               FOR UPDATE SKIP LOCKED
        )
    RETURNING ${MESSAGE_COLUMNS}`,
    [limit],
  );
  return rows.map(mapMessage);
}

/**
 * Recovers rows stranded in 'sending'. `claimBatch` flips a row to 'sending'
 * and nothing flips it back if the runner dies first — a container kill, the
 * route's `maxDuration` cut-off, a DB blip after the claim. Such a row is
 * invisible to every later claim and the message is simply never delivered.
 *
 * A row is stale when it has been 'sending' longer than `olderThanMinutes`
 * (its `updated_at` is the moment of the claim). It goes back to 'queued' —
 * with `attempts` already counted, so the retry budget still shrinks — unless
 * that budget is gone, in which case it becomes terminally 'failed' and says
 * so in `last_error`. One statement; the `RETURNING` tells us which happened.
 *
 * Idempotent and safe to run concurrently with the worker: the interval is
 * far longer than any live send, and a row another transaction is settling is
 * simply not matched.
 */
export async function requeueStale(
  options: { olderThanMinutes?: number; client?: Queryable } = {},
): Promise<RequeueStaleResult> {
  const { olderThanMinutes = STALE_SENDING_MINUTES, client = pool } = options;

  const { rows } = await client.query<{ status: EmailStatus }>(
    `UPDATE email_messages
        SET status = CASE WHEN attempts >= $2::int THEN 'failed' ELSE 'queued' END,
            last_error = CASE
                WHEN attempts >= $2::int
                THEN 'stale after ' || attempts || ' attempts'
                ELSE last_error
            END,
            updated_at = now()
      WHERE status = 'sending'
        AND updated_at < now() - make_interval(mins => $1::int)
    RETURNING status`,
    [olderThanMinutes, MAX_ATTEMPTS],
  );

  let requeued = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === "failed") failed += 1;
    else requeued += 1;
  }
  return { requeued, failed };
}

/**
 * Terminal success: the MTA accepted the message and gave us a Message-ID.
 *
 * `subject` is optional and positioned before `client` so existing two- and
 * three-argument calls keep working; it is the rendered subject, which only
 * the sender knows, and `COALESCE` means passing nothing leaves whatever the
 * column already held rather than blanking it.
 */
export async function markSent(
  id: number,
  messageId: string | null,
  subject?: string | null,
  client: Queryable = pool,
): Promise<EmailMessage | null> {
  const { rows } = await client.query<RawMessage>(
    `UPDATE email_messages
        SET status = 'sent',
            message_id = $2,
            subject = COALESCE($3::text, subject),
            last_error = NULL,
            sent_at = now(),
            updated_at = now()
      WHERE id = $1
    RETURNING ${MESSAGE_COLUMNS}`,
    [id, messageId, subject ?? null],
  );
  return rows.length === 0 ? null : mapMessage(rows[0]);
}

/**
 * Settles a failed send. Retryable (4xx, connection reset) and attempts left →
 * back to 'queued' with `scheduled_for` pushed out by `BACKOFF_MINUTES`.
 * Non-retryable (5xx, invalid address) or the last attempt → 'failed', with the
 * SMTP reason kept in `last_error` so `lixto status` can show it.
 */
export async function markFailed(
  id: number,
  error: string,
  options: { retryable: boolean } = { retryable: true },
  client: Queryable = pool,
): Promise<EmailMessage | null> {
  const current = await client.query<{ attempts: string | number }>(
    `SELECT attempts FROM email_messages WHERE id = $1`,
    [id],
  );
  if (current.rows.length === 0) return null;

  const attempts = Number(current.rows[0].attempts);
  const minutes = options.retryable ? nextRetryMinutes(attempts) : null;

  const { rows } =
    minutes === null
      ? await client.query<RawMessage>(
          `UPDATE email_messages
              SET status = 'failed',
                  last_error = $2,
                  updated_at = now()
            WHERE id = $1
          RETURNING ${MESSAGE_COLUMNS}`,
          [id, error],
        )
      : await client.query<RawMessage>(
          `UPDATE email_messages
              SET status = 'queued',
                  last_error = $2,
                  scheduled_for = now() + make_interval(mins => $3::int),
                  updated_at = now()
            WHERE id = $1
          RETURNING ${MESSAGE_COLUMNS}`,
          [id, error, minutes],
        );

  return rows.length === 0 ? null : mapMessage(rows[0]);
}

/**
 * Stops mailing an address and clears whatever was already queued for it.
 * In-flight ('sending') rows are left alone — their runner settles them.
 * Returns how many queued messages were dropped.
 */
export async function suppress(
  email: string,
  reason: SuppressionReason,
  detail?: string | null,
  client: Queryable = pool,
): Promise<{ email: string; suppressedMessages: number }> {
  const address = normalizeEmail(email);

  await client.query(
    `INSERT INTO email_suppressions (email, reason, detail)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
        SET reason = EXCLUDED.reason,
            detail = EXCLUDED.detail`,
    [address, reason, detail ?? null],
  );

  const cascade = await client.query(
    `UPDATE email_messages
        SET status = 'suppressed',
            updated_at = now()
      WHERE to_email = $1
        AND status = 'queued'`,
    [address],
  );

  return { email: address, suppressedMessages: cascade.rowCount ?? 0 };
}

/** The `email:` block of `lixto status` (ticket 113). One statement: silent
 * non-delivery has to be cheap to look at. */
export async function emailStats(client: Queryable = pool): Promise<EmailStats> {
  const { rows } = await client.query<{
    queued: string | number;
    sending: string | number;
    sent24h: string | number;
    failed24h: string | number;
    suppressed: string | number;
  }>(
    `SELECT
        count(*) FILTER (WHERE status = 'queued') AS queued,
        count(*) FILTER (WHERE status = 'sending') AS sending,
        count(*) FILTER (WHERE status = 'sent'
                           AND sent_at >= now() - interval '24 hours') AS sent24h,
        count(*) FILTER (WHERE status = 'failed'
                           AND updated_at >= now() - interval '24 hours') AS failed24h,
        (SELECT count(*) FROM email_suppressions) AS suppressed
       FROM email_messages`,
  );

  const row = rows[0];
  return {
    queued: Number(row?.queued ?? 0),
    sending: Number(row?.sending ?? 0),
    sent24h: Number(row?.sent24h ?? 0),
    failed24h: Number(row?.failed24h ?? 0),
    suppressed: Number(row?.suppressed ?? 0),
  };
}
