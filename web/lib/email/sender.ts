// The outbox worker: claim → render → SMTP → settle (ticket 111).
//
// This is the only module that talks to the MTA. It owns no SQL (that is
// `outbox.ts`) and no HTML (that is `templates.ts`); its job is the part that
// can fail in a hundred ways — a refused connection, a 4xx greylist, a 550 for
// an address that never existed — and to turn each of those into the right
// terminal state so `lixto status` never shows a lie.
//
// Two hard rules come from the infrastructure (PRODUCT §3):
//   1. Sends are sequential. Postfix on plugu-prod01 is rate-limited to ~4
//      msg/min via `default_destination_rate_delay`; parallel sends only fill
//      its queue and burn connections. `maxConnections: 1` says the same thing
//      to nodemailer.
//   2. Nothing here may throw out of the route. A dead MTA must produce
//      `{ failed: n }` with the rows back in `queued` on backoff, not a 500
//      that loses the batch in 'sending'.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs with a config that
// declares no alias, so "@/" is not resolvable from lib tests.

import nodemailer from "nodemailer";
import type SMTPPool from "nodemailer/lib/smtp-pool";
import type Mail from "nodemailer/lib/mailer";

import {
  claimBatch,
  isSuppressed,
  markFailed,
  markSent,
  requeueStale,
  suppress,
} from "./outbox";
import type { EmailMessage, EmailTemplate } from "./outbox";
import { renderTemplate } from "./templates";
import type { TemplatePayloads } from "./templates";

/** Envelope sender. A single address for every template: account mail and
 * digests share the domain whose SPF/DKIM/DMARC we control. */
export const EMAIL_FROM =
  process.env.LIXTO_EMAIL_FROM ?? "Lixto <nao-responda@lixto.com.br>";

/** Optional: where a human reply should go, since the From: is a no-reply. */
export const EMAIL_REPLY_TO = process.env.LIXTO_EMAIL_REPLY_TO;

/** Rows per worker pass. One Dokploy tick is every 5 min and the MTA accepts
 * ~4 msg/min, so a larger batch just waits inside Postfix. */
export const DEFAULT_BATCH_LIMIT = 20;

/** Upper bound for a caller-supplied `limit` (the internal route takes one). */
export const MAX_BATCH_LIMIT = 100;

/** Only what this module needs from a transport, so tests can inject a stub
 * without reconstructing nodemailer's surface. A real `Transporter` satisfies
 * it structurally. */
export type MailTransport = {
  sendMail(message: Mail.Options): Promise<{ messageId?: string | null }>;
  close?: () => void;
};

export type SenderDeps = {
  /** Injected by tests and reused across a batch by `runEmailWorker`. */
  transport?: MailTransport;
};

export type SendOutcome = {
  id: number;
  status: "sent" | "failed";
  /** Meaningful only when `status === "failed"`. */
  retryable: boolean;
  /** The address was added to `email_suppressions` by this send. */
  suppressed: boolean;
  error?: string;
};

export type EmailWorkerOptions = {
  limit?: number;
  deps?: SenderDeps;
};

export type EmailWorkerResult = {
  claimed: number;
  sent: number;
  failed: number;
  suppressed: number;
  /** Stale 'sending' rows swept back to 'queued' (or failed for good) by
   * `requeueStale` before this pass claimed anything. */
  requeued: number;
};

/**
 * A fresh transport per call: the host/port are the in-network MTA (ticket
 * 109) read at request time, never baked into the build. `pool: true` with a
 * single connection lets one worker pass reuse the same SMTP session for its
 * whole batch; `ignoreTLS` + `secure: false` because the hop is Docker-internal
 * (the TLS that matters is the MTA's outbound one, direct-to-MX).
 */
export function getTransport(): MailTransport {
  const options: SMTPPool.Options = {
    host: process.env.LIXTO_SMTP_HOST ?? "lixto-mail",
    port: Number(process.env.LIXTO_SMTP_PORT ?? 25),
    secure: false,
    ignoreTLS: true,
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
  };
  return nodemailer.createTransport(options);
}

/** Error codes that mean "the message will never be accepted, stop trying". */
const PERMANENT_CODES = new Set(["EENVELOPE", "EMESSAGE"]);

/** Codes that mean "the MTA was unreachable or busy" — always worth a retry. */
const TRANSIENT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNECTION",
  "ETIMEDOUT",
  "ETIMEOUT",
  "ESOCKET",
  "EAI_AGAIN",
  "EDNS",
  "EPROTOCOL",
]);

/** Phrases in an SMTP reply that identify a dead mailbox (not a policy block,
 * not a full quota) — the only case where we stop mailing the address. */
const HARD_BOUNCE_PHRASES = [
  "5.1.1",
  "user unknown",
  "mailbox unavailable",
  "no such user",
];

type SmtpErrorish = {
  code?: unknown;
  responseCode?: unknown;
  response?: unknown;
  message?: unknown;
};

function asRecord(err: unknown): SmtpErrorish {
  return typeof err === "object" && err !== null ? (err as SmtpErrorish) : {};
}

/** The text we persist in `last_error` and show in `lixto status`: the SMTP
 * reply when there is one, the JS message otherwise. */
function errorText(err: unknown): string {
  const raw = asRecord(err);
  const parts = [
    typeof raw.code === "string" ? raw.code : null,
    typeof raw.responseCode === "number" ? String(raw.responseCode) : null,
    typeof raw.response === "string" && raw.response.length > 0
      ? raw.response
      : typeof raw.message === "string"
        ? raw.message
        : null,
  ].filter((part): part is string => Boolean(part));

  if (parts.length > 0) return parts.join(" ").slice(0, 1000);
  return String(err).slice(0, 1000);
}

export type ErrorClassification = {
  /** False → `markFailed(..., { retryable: false })`: terminal now. */
  retryable: boolean;
  /** True → the address itself is dead; suppress it. */
  hardBounce: boolean;
  /** `errorText(err)`, carried so callers don't recompute it. */
  message: string;
};

/**
 * Decides what a send failure means. Unknown errors are retryable on purpose:
 * a bug here should cost a delayed email, not a silently dropped one — the
 * attempt counter in `markFailed` stops the loop after `MAX_ATTEMPTS`.
 */
export function classifyError(err: unknown): ErrorClassification {
  const raw = asRecord(err);
  const code = typeof raw.code === "string" ? raw.code.toUpperCase() : null;
  const responseCode =
    typeof raw.responseCode === "number" ? raw.responseCode : null;
  const message = errorText(err);
  const haystack = message.toLowerCase();

  let retryable: boolean;
  if (code && PERMANENT_CODES.has(code)) {
    // A rejected envelope (invalid recipient) never gets better.
    retryable = false;
  } else if (responseCode !== null && responseCode >= 500) {
    retryable = false;
  } else if (code && TRANSIENT_CODES.has(code)) {
    retryable = true;
  } else {
    // 4xx (greylisting, rate limit) and anything unrecognized.
    retryable = true;
  }

  const hardBounce =
    !retryable && HARD_BOUNCE_PHRASES.some((phrase) => haystack.includes(phrase));

  return { retryable, hardBounce, message };
}

function unsubscribeUrlOf(row: EmailMessage): string | null {
  const url = row.payload?.unsubscribeUrl;
  return typeof url === "string" && url.length > 0 ? url : null;
}

function buildMessage(
  row: EmailMessage,
  rendered: { subject: string; html: string; text: string },
): Mail.Options {
  const message: Mail.Options = {
    from: EMAIL_FROM,
    to: row.to_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  };

  if (EMAIL_REPLY_TO) message.replyTo = EMAIL_REPLY_TO;

  // Only the digest is unsubscribable (PRODUCT §2): account mail is
  // transactional, and advertising a List-Unsubscribe on it would be a lie.
  // Gmail/Yahoo's bulk-sender rules require the pair — a bare
  // List-Unsubscribe without List-Unsubscribe-Post is not one-click
  // compliant — and the URL is the POST-capable route (ticket 115).
  if (row.template === "daily_digest") {
    const url = unsubscribeUrlOf(row);
    if (url) {
      message.headers = {
        "List-Unsubscribe": `<${url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
    }
  }

  return message;
}

/**
 * Renders, sends and settles exactly one claimed row. Never rejects for a send
 * error — the outcome is the return value — so `runEmailWorker` only has to
 * guard against the outbox itself failing.
 */
export async function sendOne(
  row: EmailMessage,
  deps: SenderDeps = {},
): Promise<SendOutcome> {
  let transport: MailTransport | undefined;
  try {
    // `br-validators.ts`'s email regex accepts "a@b.com,c.d" — a comma- or
    // semicolon-joined string nodemailer would happily split into multiple
    // recipients. Reject it here rather than loosen the shared validator.
    if (/[,;]/.test(row.to_email)) {
      const message = `to_email is not a single address: "${row.to_email}"`;
      await markFailed(row.id, message, { retryable: false });
      return {
        id: row.id,
        status: "failed",
        retryable: false,
        suppressed: false,
        error: message,
      };
    }

    // `payload` is JSONB: typed on the way in (ticket 112), plain on the way
    // out. A stale template name throws here and settles as non-retryable.
    const rendered = renderTemplate(
      row.template as EmailTemplate,
      row.payload as TemplatePayloads[EmailTemplate],
    );
    transport = deps.transport ?? getTransport();

    // The atomic insert (`enqueue`) and `requeueStale` both check suppression
    // at their own moment, but a claimed row can sit for seconds before this
    // line runs — long enough for the unsubscribe route to commit in between.
    // Re-check right before the network call so that race never mails anyone.
    if (await isSuppressed(row.to_email)) {
      const message = "recipient became suppressed after claim";
      await markFailed(row.id, message, { retryable: false });
      return {
        id: row.id,
        status: "failed",
        retryable: false,
        suppressed: true,
        error: message,
      };
    }

    const info = await transport.sendMail(buildMessage(row, rendered));
    await markSent(row.id, info?.messageId ?? null, rendered.subject);
    return { id: row.id, status: "sent", retryable: false, suppressed: false };
  } catch (err) {
    const { retryable, hardBounce, message } = classifyError(err);
    let suppressed = false;
    if (hardBounce) {
      // Before markFailed: `suppress` only cascades 'queued' rows, and this one
      // is still 'sending', so the order can't clobber our own state.
      await suppress(row.to_email, "hard_bounce", message);
      suppressed = true;
    }
    await markFailed(row.id, message, { retryable });
    return { id: row.id, status: "failed", retryable, suppressed, error: message };
  } finally {
    // Only tear down a pool we opened; an injected transport is the caller's.
    if (!deps.transport && transport?.close) transport.close();
  }
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_BATCH_LIMIT;
  }
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_BATCH_LIMIT);
}

/** Every claimed row back to `queued` with backoff, used when the transport
 * itself can't be built (bad config, DNS gone). */
async function failWholeBatch(
  rows: EmailMessage[],
  message: string,
): Promise<number> {
  let failed = 0;
  for (const row of rows) {
    try {
      await markFailed(row.id, message, { retryable: true });
    } catch (err) {
      console.error("[email/sender] could not settle row", row.id, err);
    }
    failed += 1;
  }
  return failed;
}

/**
 * One worker pass: claim a batch, send it one message at a time, return the
 * counts. Each row is isolated — a single bad address cannot abort the run —
 * and the transport is created once and closed at the end so a scheduled
 * invocation doesn't leak an SMTP socket.
 */
export async function runEmailWorker(
  options: EmailWorkerOptions = {},
): Promise<EmailWorkerResult> {
  const limit = clampLimit(options.limit);

  // Recover anything a previous pass abandoned mid-send before claiming a
  // fresh batch, so a crashed runner's messages aren't invisible forever.
  const { requeued } = await requeueStale();
  const rows = await claimBatch(limit);

  const result: EmailWorkerResult = {
    claimed: rows.length,
    sent: 0,
    failed: 0,
    suppressed: 0,
    requeued,
  };
  if (rows.length === 0) return result;

  const injected = options.deps?.transport;
  let transport: MailTransport;
  try {
    transport = injected ?? getTransport();
  } catch (err) {
    const message = errorText(err);
    console.error("[email/sender] transport unavailable", err);
    result.failed = await failWholeBatch(rows, message);
    return result;
  }

  try {
    for (const row of rows) {
      try {
        const outcome = await sendOne(row, { transport });
        if (outcome.status === "sent") {
          result.sent += 1;
        } else {
          result.failed += 1;
          if (outcome.suppressed) result.suppressed += 1;
        }
      } catch (err) {
        // Only reachable if the outbox write itself failed; the row is left in
        // 'sending' and picked up by the stuck-row sweep, not lost.
        console.error("[email/sender] row failed to settle", row.id, err);
        result.failed += 1;
      }
    }
  } finally {
    if (!injected && transport.close) transport.close();
  }

  return result;
}
