import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs with no path
// alias. The outbox is mocked so these tests never touch a database (and
// `db.ts`, with its pool, stays out of the module graph); the maildir itself
// is real, because "did the file leave new/?" is half the behaviour.
vi.mock("../db", () => ({ pool: { query: vi.fn() } }));

vi.mock("./outbox", () => ({
  markFailed: vi.fn(),
  suppress: vi.fn(),
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
}));

import { ingestBounces, isHardBounce, parseDsn } from "./bounces";
import { markFailed, suppress } from "./outbox";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** A Postfix-shaped Gmail rejection: 550 5.1.1, folded Diagnostic-Code, and
 * the returned headers carrying the original Message-ID. */
const HARD_BOUNCE = `From: MAILER-DAEMON@mail.lixto.com.br (Mail Delivery System)
To: <nao-responda@lixto.com.br>
Subject: Undelivered Mail Returned to Sender
Message-Id: <20260903120000.9C1F2@mail.lixto.com.br>
Content-Type: multipart/report; report-type=delivery-status;
\tboundary="9C1F2.1757000000/mail.lixto.com.br"

--9C1F2.1757000000/mail.lixto.com.br
Content-Description: Notification
Content-Type: text/plain; charset=us-ascii

This is the mail system at host mail.lixto.com.br.

<naoexiste@gmail.com>: host gmail-smtp-in.l.google.com said: 550-5.1.1 The
    email account that you tried to reach does not exist.

--9C1F2.1757000000/mail.lixto.com.br
Content-Description: Delivery report
Content-Type: message/delivery-status

Reporting-MTA: dns; mail.lixto.com.br
X-Postfix-Queue-ID: 9C1F2
Arrival-Date: Thu,  3 Sep 2026 12:00:00 +0000 (UTC)

Final-Recipient: rfc822; NaoExiste@gmail.com
Original-Recipient: rfc822;naoexiste@gmail.com
Action: failed
Status: 5.1.1
Remote-MTA: dns; gmail-smtp-in.l.google.com
Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach
    does not exist. Please try double-checking the recipient's email address
    for typos.

--9C1F2.1757000000/mail.lixto.com.br
Content-Description: Undelivered Message Headers
Content-Type: text/rfc822-headers

Return-Path: <nao-responda@lixto.com.br>
Message-Id: <outbox-42@mail.lixto.com.br>
From: Lixto <nao-responda@lixto.com.br>
To: naoexiste@gmail.com
Subject: Bem-vindo ao Lixto

--9C1F2.1757000000/mail.lixto.com.br--
`;

/** A 4.2.2 "over quota", still in the remote queue: nothing is terminal yet. */
const SOFT_BOUNCE = `From: MAILER-DAEMON@mail.lixto.com.br (Mail Delivery System)
To: <nao-responda@lixto.com.br>
Subject: Delayed Mail (still being retried)
Content-Type: multipart/report; report-type=delivery-status; boundary="AA11"

--AA11
Content-Type: text/plain; charset=us-ascii

Your message could not be delivered for more than 4 hours.

--AA11
Content-Type: message/delivery-status

Reporting-MTA: dns; mail.lixto.com.br

Final-Recipient: rfc822; cheia@empresa.com.br
Action: delayed
Status: 4.2.2
Diagnostic-Code: smtp; 452 4.2.2 The email account that you tried to reach is over quota.

--AA11
Content-Type: text/rfc822-headers

Message-Id: <outbox-43@mail.lixto.com.br>

--AA11--
`;

const MALFORMED = "isto não é um DSN, é lixo que alguém entregou na caixa\n";

let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dir = await mkdtemp(path.join(tmpdir(), "lixto-bounces-"));
  await mkdir(path.join(dir, "new"), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function drop(name: string, content: string) {
  await writeFile(path.join(dir, "new", name), content, "utf8");
}

/** A `Queryable` returning canned rows, one result per call in order. */
function client(...results: unknown[][]) {
  const query = vi.fn();
  for (const rows of results) query.mockResolvedValueOnce({ rows });
  query.mockResolvedValue({ rows: [] });
  return { query, calls: query };
}

describe("parseDsn", () => {
  it("reads recipient, status, diagnostic and original message-id", () => {
    const dsn = parseDsn(HARD_BOUNCE);

    expect(dsn).not.toBeNull();
    expect(dsn?.recipient).toBe("naoexiste@gmail.com");
    expect(dsn?.status).toBe("5.1.1");
    // Folded continuation lines are joined, the "smtp;" type prefix dropped.
    expect(dsn?.diagnostic).toContain("550-5.1.1");
    expect(dsn?.diagnostic).toContain("does not exist");
    expect(dsn?.diagnostic.startsWith("smtp;")).toBe(false);
    // The returned message's id, never the DSN's own.
    expect(dsn?.originalMessageId).toBe("outbox-42@mail.lixto.com.br");
  });

  it("reads a soft bounce as 4.x.x", () => {
    expect(parseDsn(SOFT_BOUNCE)?.status).toBe("4.2.2");
    expect(isHardBounce("4.2.2")).toBe(false);
    expect(isHardBounce("5.1.1")).toBe(true);
  });

  it("returns null for anything that is not a DSN", () => {
    expect(parseDsn(MALFORMED)).toBeNull();
    expect(parseDsn("")).toBeNull();
  });
});

describe("ingestBounces", () => {
  it("fails the matching row and suppresses the address on a 5.x.x", async () => {
    await drop("gmail-550", HARD_BOUNCE);
    const db = client([{ id: "42" }]);

    const result = await ingestBounces({ dir, deps: { client: db } });

    expect(result).toEqual({
      files: 1,
      hard: 1,
      soft: 0,
      unparsed: 0,
      unmatched: 0,
      errored: 0,
    });

    // Matched by Message-ID *and* recipient, not by "newest sent to that
    // address" — a forged report quoting a real Message-ID must not settle a
    // row addressed to someone else.
    expect(db.calls).toHaveBeenCalledTimes(1);
    expect(db.calls.mock.calls[0][0]).toContain("message_id");
    expect(db.calls.mock.calls[0][1]).toEqual([
      "outbox-42@mail.lixto.com.br",
      "naoexiste@gmail.com",
    ]);

    expect(mock(markFailed)).toHaveBeenCalledWith(
      42,
      expect.stringContaining("550-5.1.1"),
      { retryable: false },
    );
    expect(mock(suppress)).toHaveBeenCalledWith(
      "naoexiste@gmail.com",
      "hard_bounce",
      expect.stringContaining("550-5.1.1"),
    );

    // The file left new/ so the next pass does not settle it twice.
    expect(await readdir(path.join(dir, "new"))).toEqual([]);
    expect(await readdir(path.join(dir, "cur"))).toEqual(["gmail-550"]);
  });

  it("falls back to the newest sent row when the message-id matches nothing", async () => {
    await drop("gmail-550", HARD_BOUNCE);
    const db = client([], [{ id: "7" }]);

    const result = await ingestBounces({ dir, deps: { client: db } });

    expect(result.hard).toBe(1);
    expect(db.calls).toHaveBeenCalledTimes(2);
    expect(db.calls.mock.calls[1][0]).toContain("status = 'sent'");
    expect(db.calls.mock.calls[1][1]).toEqual(["naoexiste@gmail.com"]);
    expect(mock(markFailed)).toHaveBeenCalledWith(
      7,
      expect.any(String),
      { retryable: false },
    );
  });

  it("ignores a hard DSN that matches no outbox row (forged-suppression guard)", async () => {
    // The bounce address accepts mail from the whole internet, so a DSN for
    // an address we never wrote to is an unauthenticated claim — acting on it
    // would let anyone suppress an arbitrary address.
    await drop("gmail-550", HARD_BOUNCE);
    const db = client([], []);

    const result = await ingestBounces({ dir, deps: { client: db } });

    expect(result).toEqual({
      files: 1,
      hard: 0,
      soft: 0,
      unparsed: 0,
      unmatched: 1,
      errored: 0,
    });
    expect(mock(markFailed)).not.toHaveBeenCalled();
    expect(mock(suppress)).not.toHaveBeenCalled();
    // Kept for a human, out of new/ so it is not re-counted every pass.
    expect(await readdir(path.join(dir, "failed"))).toEqual(["gmail-550"]);
  });

  it("changes nothing on a 4.x.x", async () => {
    await drop("delayed", SOFT_BOUNCE);
    const db = client();

    const result = await ingestBounces({ dir, deps: { client: db } });

    expect(result).toEqual({
      files: 1,
      hard: 0,
      soft: 1,
      unparsed: 0,
      unmatched: 0,
      errored: 0,
    });
    expect(db.calls).not.toHaveBeenCalled();
    expect(mock(markFailed)).not.toHaveBeenCalled();
    expect(mock(suppress)).not.toHaveBeenCalled();
    expect(await readdir(path.join(dir, "cur"))).toEqual(["delayed"]);
  });

  it("files unparseable mail under failed/ without touching the outbox", async () => {
    await drop("garbage", MALFORMED);
    const db = client();

    const result = await ingestBounces({ dir, deps: { client: db } });

    expect(result).toEqual({
      files: 1,
      hard: 0,
      soft: 0,
      unparsed: 1,
      unmatched: 0,
      errored: 0,
    });
    expect(mock(markFailed)).not.toHaveBeenCalled();
    expect(mock(suppress)).not.toHaveBeenCalled();
    expect(await readdir(path.join(dir, "failed"))).toEqual(["garbage"]);
  });

  it("processes a mixed batch and never lets one bad file stop the rest", async () => {
    await drop("1-garbage", MALFORMED);
    await drop("2-hard", HARD_BOUNCE);
    await drop("3-soft", SOFT_BOUNCE);
    const db = client([{ id: "42" }]);

    const result = await ingestBounces({ dir, deps: { client: db } });

    expect(result).toEqual({
      files: 3,
      hard: 1,
      soft: 1,
      unparsed: 1,
      unmatched: 0,
      errored: 0,
    });
    expect(mock(suppress)).toHaveBeenCalledTimes(1);
    expect(await readdir(path.join(dir, "new"))).toEqual([]);
  });

  it("leaves the file in new/ when the database fails, and keeps going", async () => {
    await drop("1-hard", HARD_BOUNCE);
    await drop("2-soft", SOFT_BOUNCE);
    const db = { query: vi.fn().mockRejectedValue(new Error("db down")) };

    const result = await ingestBounces({ dir, deps: { client: db } });

    expect(result).toEqual({
      files: 2,
      hard: 0,
      soft: 1,
      unparsed: 0,
      unmatched: 0,
      errored: 1,
    });
    expect(mock(suppress)).not.toHaveBeenCalled();
    expect(await readdir(path.join(dir, "new"))).toEqual(["1-hard"]);
  });

  it("reports zeros when the maildir is not mounted", async () => {
    const db = client();

    const result = await ingestBounces({
      dir: path.join(dir, "does-not-exist"),
      deps: { client: db },
    });

    expect(result).toEqual({
      files: 0,
      hard: 0,
      soft: 0,
      unparsed: 0,
      unmatched: 0,
      errored: 0,
    });
    expect(db.calls).not.toHaveBeenCalled();
  });

  it("also reads a plain drop directory (no maildir new/)", async () => {
    const flat = await mkdtemp(path.join(tmpdir(), "lixto-flat-"));
    await writeFile(path.join(flat, "gmail-550"), HARD_BOUNCE, "utf8");
    const db = client([{ id: "42" }]);

    const result = await ingestBounces({ dir: flat, deps: { client: db } });

    expect(result.hard).toBe(1);
    expect(await readdir(path.join(flat, "cur"))).toEqual(["gmail-550"]);
  });
});

describe("POST /api/internal/email/bounces", () => {
  const url = "http://internal/api/internal/email/bounces";

  it("rejects a request without the internal token", async () => {
    const { POST } = await import("../../app/api/internal/email/bounces/route");
    process.env.LIXTO_INTERNAL_TOKEN = "secret-token";

    const response = await POST(new Request(url, { method: "POST" }));

    expect(response.status).toBe(401);
  });

  it("returns the ingestion counters", async () => {
    const { POST } = await import("../../app/api/internal/email/bounces/route");
    process.env.LIXTO_INTERNAL_TOKEN = "secret-token";
    process.env.LIXTO_BOUNCE_MAILDIR = path.join(dir, "unmounted");

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-lixto-internal-token": "secret-token" },
      }),
    );

    expect(response.status).toBe(200);
    // Not mounted in this environment: the pass is a no-op, not a failure.
    expect(await response.json()).toEqual({
      files: 0,
      hard: 0,
      soft: 0,
      unparsed: 0,
      unmatched: 0,
      errored: 0,
    });
  });
});
