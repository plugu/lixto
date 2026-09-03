// Asynchronous bounce ingestion (ticket 120, PRODUCT §3).
//
// Why this module exists: Postfix accepts a message on the local hop and only
// then delivers it direct-to-MX, so `classifyError` in sender.ts sees the
// *local* handshake and nothing else. A recipient that does not exist is
// recorded as `sent`, and the rejection comes back minutes later as an RFC
// 3464 DSN addressed to our envelope sender. infra/mail now writes those DSNs
// into a maildir ($LIXTO_BOUNCE_MAILDIR, shared with the MTA container); this
// module turns each of them back into the outbox state that was already true:
// the message `failed`, and — for a 5.x.x — the address suppressed.
//
// Nothing here changes the synchronous path. A hard bounce caught at handshake
// time is still settled by sender.ts; this is the same conclusion reached from
// the other side, and both are idempotent.
//
// Design rules:
//   1. Never crash the batch. One malformed blob, one unreadable file or one
//      failed lookup must not stop the other DSNs — a lost bounce is a dead
//      address we keep mailing.
//   2. Every file leaves `new/`. Parsed files go to `cur/`, garbage goes to
//      `failed/` (kept, not deleted: a parser bug is only debuggable with the
//      input that broke it).
//   3. A missing maildir is zeros, not an error. The web container may not
//      mount the MTA volume yet (see the route + README), and a cron that
//      exits 1 every five minutes is noise, not a signal.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs with a config
// that declares no alias, so "@/" is not resolvable from lib tests.

import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";

import { pool } from "../db";
import { markFailed, normalizeEmail, suppress } from "./outbox";
import type { Queryable } from "./outbox";

/** Where the MTA drops DSNs when nothing says otherwise. The real value is
 * `LIXTO_BOUNCE_MAILDIR` and must match the mail container's env of the same
 * name (infra/mail/entrypoint.sh) — the two mount the same volume. */
export const DEFAULT_BOUNCE_MAILDIR = "/var/db/mail/bounces";

/** Read per call, not at import: the route is `force-dynamic` and the CLI
 * triggers it in a long-lived process, so the env must be the deployment's,
 * not the build's. */
export function bounceMaildir(): string {
  return process.env.LIXTO_BOUNCE_MAILDIR ?? DEFAULT_BOUNCE_MAILDIR;
}

/** One recipient's verdict, as read off a `message/delivery-status` part. */
export type ParsedDsn = {
  /** `Final-Recipient`, lowercased and stripped of angle brackets. */
  recipient: string;
  /** RFC 3463 status, e.g. `5.1.1`. */
  status: string;
  /** `Diagnostic-Code` if present (the SMTP reply we show in `last_error`),
   * otherwise a short summary built from `Action`/`Status`. */
  diagnostic: string;
  /** The `Message-ID` of the message that bounced, without angle brackets. */
  originalMessageId: string | null;
};

export type BounceDeps = {
  markFailed?: typeof markFailed;
  suppress?: typeof suppress;
  /** Defaults to the pool; injected by tests so they never touch a database. */
  client?: Queryable;
};

export type BounceIngestResult = {
  /** Files taken out of the maildir this pass. */
  files: number;
  /** 5.x.x with a matching outbox row: message failed, address suppressed. */
  hard: number;
  /** 4.x.x (and the 2.x.x "delivered/delayed" notices): logged, nothing
   * written — the outbox is already retrying, or already correct. */
  soft: number;
  /** Not a DSN we could read; moved to `failed/`. */
  unparsed: number;
  /** A well-formed hard DSN for an address we never sent to. The bounce
   * address accepts mail from the whole internet, so an unmatched claim is
   * exactly what a forged suppression attack looks like — nothing is written,
   * the file goes to `failed/` for a human to look at. */
  unmatched: number;
  /** The database failed mid-settle; the file stays in `new/` and the next
   * pass retries it. Kept apart from `unparsed` so an infra outage does not
   * read as a parser bug in the counters. */
  errored: number;
};

/** DSNs are tiny (Postfix's `bounce_size_limit` defaults to 50 kB). Anything
 * larger is not one, and parsing it would only burn memory on junk that a
 * stranger mailed to the open bounce address. */
const MAX_DSN_BYTES = 512 * 1024;

const STATUS_PATTERN = /^([245])\.\d{1,3}\.\d{1,3}$/;

/** Splits a header block into logical lines: RFC 5322 folding means a line
 * starting with space/tab continues the previous one, and Postfix folds long
 * `Diagnostic-Code` values exactly that way. */
function unfold(block: string): string[] {
  const lines: string[] = [];
  for (const line of block.split("\n")) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += ` ${line.trim()}`;
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function headerValue(lines: string[], name: string): string | null {
  const prefix = `${name.toLowerCase()}:`;
  for (const line of lines) {
    if (line.toLowerCase().startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }
  return null;
}

/** `rfc822; <user@host>` → `user@host`. The address type prefix is optional in
 * the wild, and some MTAs quote or bracket the address. */
function cleanAddress(raw: string): string {
  const withoutType = raw.includes(";") ? raw.slice(raw.indexOf(";") + 1) : raw;
  return normalizeEmail(withoutType.replace(/[<>"]/g, ""));
}

/** `smtp; 550 5.1.1 ...` → `550 5.1.1 ...`; the type prefix says nothing we
 * do not already know from `Status`. */
function cleanDiagnostic(raw: string): string {
  const withoutType = /^[a-z0-9-]+;/i.test(raw)
    ? raw.slice(raw.indexOf(";") + 1)
    : raw;
  return withoutType.trim().replace(/\s+/g, " ").slice(0, 1000);
}

/**
 * Pulls the verdict out of a multipart/report DSN.
 *
 * Deliberately not a full MIME parser: we locate the `message/delivery-status`
 * part, read its headers, and take the first recipient section — our messages
 * have exactly one recipient (`sender.ts` refuses a `to_email` with a comma),
 * so a multi-recipient report cannot be one of ours anyway.
 *
 * Returns `null` for anything that is not a readable DSN; the caller files
 * those under `failed/` instead of guessing.
 */
export function parseDsn(raw: string): ParsedDsn | null {
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const partIndex = lines.findIndex((line) =>
    /^content-type:\s*message\/delivery-status/i.test(line.trim()),
  );
  if (partIndex === -1) return null;

  // Skip the rest of that part's own headers, i.e. up to the blank line.
  let start = partIndex + 1;
  while (start < lines.length && lines[start].trim() !== "") start += 1;
  start += 1;

  // The part ends at the next MIME boundary line.
  let end = start;
  while (end < lines.length && !lines[end].startsWith("--")) end += 1;

  const fields = unfold(lines.slice(start, end).join("\n"));

  const finalRecipient =
    headerValue(fields, "Final-Recipient") ??
    headerValue(fields, "Original-Recipient");
  const status = headerValue(fields, "Status");
  if (!finalRecipient || !status) return null;

  const normalizedStatus = status.split(/\s/)[0];
  if (!STATUS_PATTERN.test(normalizedStatus)) return null;

  const recipient = cleanAddress(finalRecipient);
  if (!recipient.includes("@")) return null;

  const diagnosticCode = headerValue(fields, "Diagnostic-Code");
  const action = headerValue(fields, "Action");
  const diagnostic = diagnosticCode
    ? cleanDiagnostic(diagnosticCode)
    : `${action ?? "failed"} ${normalizedStatus}`;

  return {
    recipient,
    status: normalizedStatus,
    diagnostic,
    originalMessageId:
      originalMessageIdOf(fields) ?? returnedMessageIdOf(lines, end),
  };
}

function stripBrackets(value: string): string {
  return value.replace(/[<>]/g, "").trim();
}

function originalMessageIdOf(fields: string[]): string | null {
  const value = headerValue(fields, "Original-Message-ID");
  return value ? stripBrackets(value) : null;
}

/**
 * The `Message-ID` of the returned message, from the
 * `message/rfc822[-headers]` part. Searched strictly *after* the
 * delivery-status part so we can never pick up the DSN's own `Message-ID`,
 * which sits in the report's top-level headers.
 */
function returnedMessageIdOf(lines: string[], from: number): string | null {
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^message-id:/i.test(line)) {
      return stripBrackets(line.slice(line.indexOf(":") + 1));
    }
  }
  return null;
}

export function isHardBounce(status: string): boolean {
  return status.startsWith("5");
}

/**
 * The outbox row a DSN is about: the one whose `message_id` the report quotes,
 * or — when the report gives us nothing to match on, which is common once a
 * remote MTA has rewritten the returned headers — the newest message we
 * believe we sent to that address. Angle brackets are stripped on both sides
 * because MTAs disagree about carrying them.
 *
 * Both lookups also require `to_email` to be the DSN's `Final-Recipient`. The
 * DSN is unauthenticated input (the bounce address accepts mail from anyone),
 * so a quoted Message-ID must never be allowed to settle a row addressed to
 * someone other than the recipient the report claims bounced.
 *
 * `null` means "no row to settle" — and therefore no suppression either: a
 * hard status alone, with no message of ours behind it, is a stranger's
 * unverified claim, not evidence the address is dead.
 */
async function findMessageRowId(
  client: Queryable,
  recipient: string,
  originalMessageId: string | null,
): Promise<number | null> {
  if (originalMessageId) {
    const { rows } = await client.query<{ id: string | number }>(
      `SELECT id
         FROM email_messages
        WHERE btrim(message_id, '<>') = $1
          AND to_email = $2
        ORDER BY id DESC
        LIMIT 1`,
      [originalMessageId, recipient],
    );
    if (rows.length > 0) return Number(rows[0].id);
  }

  const { rows } = await client.query<{ id: string | number }>(
    `SELECT id
       FROM email_messages
      WHERE to_email = $1
        AND status = 'sent'
      ORDER BY sent_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [recipient],
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
}

async function moveTo(file: string, dir: string, name: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await rename(file, path.join(dir, name));
  } catch (err) {
    // Worst case the file is read again next pass; both writes are idempotent
    // (the same row failed, the same address suppressed).
    console.error("[email/bounces] could not move", file, err);
  }
}

/** `new/` when the maildir looks like a maildir, the directory itself when it
 * does not (a plain drop directory in dev/tests). `null` when neither exists —
 * which is the "not mounted" case, not an error. */
async function resolveSourceDir(dir: string): Promise<string | null> {
  const maildirNew = path.join(dir, "new");
  try {
    await readdir(maildirNew);
    return maildirNew;
  } catch {
    /* fall through to the directory itself */
  }
  try {
    await readdir(dir);
    return dir;
  } catch {
    return null;
  }
}

/**
 * One ingestion pass over the maildir. Idempotent by construction: a file is
 * only counted once because it is moved out of `new/`, and re-processing the
 * same DSN would write the same terminal state anyway.
 */
export async function ingestBounces(
  options: { dir?: string; deps?: BounceDeps } = {},
): Promise<BounceIngestResult> {
  const dir = options.dir ?? bounceMaildir();
  const deps = options.deps ?? {};
  const client = deps.client ?? pool;
  const markFailedFn = deps.markFailed ?? markFailed;
  const suppressFn = deps.suppress ?? suppress;

  const result: BounceIngestResult = {
    files: 0,
    hard: 0,
    soft: 0,
    unparsed: 0,
    unmatched: 0,
    errored: 0,
  };

  const sourceDir = await resolveSourceDir(dir);
  if (sourceDir === null) {
    console.warn(`[email/bounces] maildir ${dir} not found; nothing to ingest`);
    return result;
  }

  const entries = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  for (const name of entries) {
    const file = path.join(sourceDir, name);
    result.files += 1;

    let raw: string;
    try {
      raw = (await readFile(file, "utf8")).slice(0, MAX_DSN_BYTES);
    } catch (err) {
      console.error("[email/bounces] unreadable file", file, err);
      result.unparsed += 1;
      await moveTo(file, path.join(dir, "failed"), name);
      continue;
    }

    const dsn = parseDsn(raw);
    if (!dsn) {
      console.warn("[email/bounces] not a DSN, filing under failed/", file);
      result.unparsed += 1;
      await moveTo(file, path.join(dir, "failed"), name);
      continue;
    }

    if (!isHardBounce(dsn.status)) {
      // 4.x.x is Postfix's business: the message is still in its queue and the
      // outbox row is still 'sent'. Writing anything here would be a lie.
      console.info(
        `[email/bounces] soft bounce ${dsn.status} for ${dsn.recipient}: ${dsn.diagnostic}`,
      );
      result.soft += 1;
      await moveTo(file, path.join(dir, "cur"), name);
      continue;
    }

    try {
      const id = await findMessageRowId(
        client,
        dsn.recipient,
        dsn.originalMessageId,
      );
      if (id === null) {
        // No message of ours behind the claim. Suppressing here would let
        // anyone on the internet block an arbitrary address by mailing us a
        // forged DSN — the report is kept under failed/ for a human instead.
        console.warn(
          `[email/bounces] hard bounce with no matching outbox row for ${dsn.recipient} (${dsn.originalMessageId ?? "no message-id"}); ignoring`,
        );
        result.unmatched += 1;
        await moveTo(file, path.join(dir, "failed"), name);
        continue;
      }
      await markFailedFn(id, dsn.diagnostic, { retryable: false });
      await suppressFn(dsn.recipient, "hard_bounce", dsn.diagnostic);
      result.hard += 1;
      await moveTo(file, path.join(dir, "cur"), name);
    } catch (err) {
      // A database failure: leave the file in new/ so the next pass retries it
      // instead of silently dropping a hard bounce.
      console.error("[email/bounces] could not settle bounce", file, err);
      result.errored += 1;
    }
  }

  return result;
}
