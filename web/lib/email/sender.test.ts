import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs with no path
// alias. The outbox is mocked so these tests never touch a database (and
// `db.ts`, with its pool, stays out of the module graph); `templates.ts` is
// real, so a send exercises the actual render.
const nm = vi.hoisted(() => {
  const sendMail = vi.fn();
  const close = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail, close }));
  return { sendMail, close, createTransport };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: nm.createTransport },
  createTransport: nm.createTransport,
}));

vi.mock("./outbox", () => ({
  claimBatch: vi.fn(),
  markSent: vi.fn(),
  markFailed: vi.fn(),
  suppress: vi.fn(),
  isSuppressed: vi.fn(),
  requeueStale: vi.fn(),
}));

import { POST } from "../../app/api/internal/email/send/route";
import {
  claimBatch,
  isSuppressed,
  markFailed,
  markSent,
  requeueStale,
  suppress,
} from "./outbox";
import type { EmailMessage } from "./outbox";
import { classifyError, getTransport, runEmailWorker, sendOne } from "./sender";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function row(over: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 1,
    to_email: "maria@empresa.com.br",
    company_id: 7,
    user_id: 3,
    template: "welcome",
    payload: {
      userName: "Maria",
      companyName: "Alfa Ltda",
      appUrl: "https://app.lixto.com.br",
    },
    subject: null,
    status: "sending",
    attempts: 1,
    last_error: null,
    message_id: null,
    dedupe_key: null,
    scheduled_for: new Date("2026-01-01T09:00:00Z"),
    sent_at: null,
    created_at: new Date("2026-01-01T09:00:00Z"),
    updated_at: new Date("2026-01-01T09:00:00Z"),
    ...over,
  };
}

function digestRow(over: Partial<EmailMessage> = {}): EmailMessage {
  return row({
    id: 2,
    template: "daily_digest",
    payload: {
      companyName: "Alfa Ltda",
      appUrl: "https://app.lixto.com.br",
      unsubscribeUrl: "https://app.lixto.com.br/email/unsubscribe?t=abc",
      newCount: 12,
      matchedCount: 4,
      attentionCount: 1,
      attention: [],
    },
    ...over,
  });
}

/** A nodemailer-shaped SMTP rejection. */
function smtpError(over: Record<string, unknown>): Error {
  return Object.assign(new Error("send failed"), over);
}

const sentInfo = { messageId: "<abc123@mail.lixto.com.br>" };

beforeEach(() => {
  vi.clearAllMocks();
  nm.sendMail.mockResolvedValue(sentInfo);
  mock(claimBatch).mockResolvedValue([]);
  mock(markSent).mockResolvedValue(null);
  mock(markFailed).mockResolvedValue(null);
  mock(suppress).mockResolvedValue({ email: "x", suppressedMessages: 0 });
  mock(isSuppressed).mockResolvedValue(false);
  mock(requeueStale).mockResolvedValue({ requeued: 0, failed: 0 });
  delete process.env.LIXTO_INTERNAL_TOKEN;
});

afterEach(() => {
  delete process.env.LIXTO_INTERNAL_TOKEN;
});

describe("getTransport", () => {
  it("targets the in-network MTA with a single pooled connection", () => {
    getTransport();
    expect(nm.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "lixto-mail",
        port: 25,
        secure: false,
        ignoreTLS: true,
        pool: true,
        maxConnections: 1,
        maxMessages: 50,
      }),
    );
  });
});

describe("sendOne", () => {
  it("renders the template, sends it and records the Message-ID", async () => {
    const outcome = await sendOne(row(), { transport: { sendMail: nm.sendMail } });

    expect(outcome).toMatchObject({ id: 1, status: "sent", suppressed: false });
    expect(nm.sendMail).toHaveBeenCalledTimes(1);

    const message = nm.sendMail.mock.calls[0][0];
    expect(message.to).toBe("maria@empresa.com.br");
    expect(message.from).toContain("lixto.com.br");
    expect(message.subject).toBe("Bem-vindo ao Lixto, Maria");
    expect(message.html).toContain("Alfa Ltda");
    expect(message.text).toContain("https://app.lixto.com.br");

    expect(markSent).toHaveBeenCalledWith(
      1,
      "<abc123@mail.lixto.com.br>",
      "Bem-vindo ao Lixto, Maria",
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("adds both List-Unsubscribe headers only to the digest", async () => {
    const transport = { sendMail: nm.sendMail };

    await sendOne(row(), { transport });
    expect(nm.sendMail.mock.calls[0][0].headers).toBeUndefined();

    await sendOne(digestRow(), { transport });
    expect(nm.sendMail.mock.calls[1][0].headers).toEqual({
      "List-Unsubscribe":
        "<https://app.lixto.com.br/email/unsubscribe?t=abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("re-checks suppression right before sending and does not mail a newly suppressed address", async () => {
    mock(isSuppressed).mockResolvedValueOnce(true);

    const outcome = await sendOne(row(), {
      transport: { sendMail: nm.sendMail },
    });

    expect(isSuppressed).toHaveBeenCalledWith("maria@empresa.com.br");
    expect(nm.sendMail).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      id: 1,
      status: "failed",
      retryable: false,
      suppressed: true,
    });
    expect(markFailed).toHaveBeenCalledWith(1, expect.any(String), {
      retryable: false,
    });
  });

  it("rejects a comma-joined address without sending, non-retryably", async () => {
    const outcome = await sendOne(
      row({ to_email: "a@b.com,c.d" }),
      { transport: { sendMail: nm.sendMail } },
    );

    expect(nm.sendMail).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      id: 1,
      status: "failed",
      retryable: false,
      suppressed: false,
    });
    expect(markFailed).toHaveBeenCalledWith(
      1,
      expect.stringContaining("a@b.com,c.d"),
      { retryable: false },
    );
    expect(markSent).not.toHaveBeenCalled();
  });

  it("suppresses the address on a 550 user unknown", async () => {
    nm.sendMail.mockRejectedValueOnce(
      smtpError({
        code: "EENVELOPE",
        responseCode: 550,
        response: "550 5.1.1 <ghost@empresa.com.br>: User unknown",
      }),
    );

    const outcome = await sendOne(row({ to_email: "ghost@empresa.com.br" }), {
      transport: { sendMail: nm.sendMail },
    });

    expect(outcome).toMatchObject({
      status: "failed",
      retryable: false,
      suppressed: true,
    });
    expect(suppress).toHaveBeenCalledWith(
      "ghost@empresa.com.br",
      "hard_bounce",
      expect.stringContaining("5.1.1"),
    );
    expect(markFailed).toHaveBeenCalledWith(
      1,
      expect.stringContaining("5.1.1"),
      { retryable: false },
    );
    expect(markSent).not.toHaveBeenCalled();
  });

  it("keeps a connection refusal retryable and does not suppress", async () => {
    nm.sendMail.mockRejectedValueOnce(
      smtpError({ code: "ECONNREFUSED", errno: -61 }),
    );

    const outcome = await sendOne(row(), {
      transport: { sendMail: nm.sendMail },
    });

    expect(outcome).toMatchObject({ status: "failed", retryable: true });
    expect(markFailed).toHaveBeenCalledWith(
      1,
      expect.stringContaining("ECONNREFUSED"),
      { retryable: true },
    );
    expect(suppress).not.toHaveBeenCalled();
  });
});

describe("classifyError", () => {
  it("treats 5xx as permanent and 4xx as transient", () => {
    expect(classifyError(smtpError({ responseCode: 550 })).retryable).toBe(
      false,
    );
    expect(classifyError(smtpError({ responseCode: 451 })).retryable).toBe(true);
  });

  it("treats timeouts and DNS failures as transient", () => {
    for (const code of ["ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"]) {
      expect(classifyError(smtpError({ code })).retryable).toBe(true);
    }
  });

  it("flags a hard bounce only for a dead mailbox", () => {
    expect(
      classifyError(
        smtpError({ responseCode: 550, response: "550 Mailbox unavailable" }),
      ).hardBounce,
    ).toBe(true);
    expect(
      classifyError(
        smtpError({ responseCode: 550, response: "550 Spam message rejected" }),
      ).hardBounce,
    ).toBe(false);
  });

  it("defaults an unknown error to retryable", () => {
    expect(classifyError(new Error("boom")).retryable).toBe(true);
  });
});

describe("runEmailWorker", () => {
  it("counts a batch and closes the transport it opened", async () => {
    mock(claimBatch).mockResolvedValue([row(), digestRow()]);

    const result = await runEmailWorker();

    expect(result).toEqual({
      claimed: 2,
      sent: 2,
      failed: 0,
      suppressed: 0,
      requeued: 0,
    });
    expect(claimBatch).toHaveBeenCalledWith(20);
    expect(nm.createTransport).toHaveBeenCalledTimes(1);
    expect(nm.close).toHaveBeenCalledTimes(1);
  });

  it("sweeps stale 'sending' rows before claiming and surfaces the count", async () => {
    mock(requeueStale).mockResolvedValueOnce({ requeued: 3, failed: 1 });
    mock(claimBatch).mockResolvedValue([]);

    const result = await runEmailWorker();

    expect(result).toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
      suppressed: 0,
      requeued: 3,
    });
    expect(requeueStale).toHaveBeenCalledTimes(1);
    const requeueOrder = mock(requeueStale).mock.invocationCallOrder[0];
    const claimOrder = mock(claimBatch).mock.invocationCallOrder[0];
    expect(requeueOrder).toBeLessThan(claimOrder);
  });

  it("keeps going after a row throws out of the outbox", async () => {
    mock(claimBatch).mockResolvedValue([row({ id: 1 }), row({ id: 2 })]);
    mock(markSent).mockRejectedValueOnce(new Error("db gone"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runEmailWorker();

    expect(result).toEqual({
      claimed: 2,
      sent: 1,
      failed: 1,
      suppressed: 0,
      requeued: 0,
    });
    expect(nm.sendMail).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("counts a hard bounce as failed and suppressed", async () => {
    mock(claimBatch).mockResolvedValue([row()]);
    nm.sendMail.mockRejectedValueOnce(
      smtpError({ responseCode: 550, response: "550 5.1.1 User unknown" }),
    );

    const result = await runEmailWorker();

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      suppressed: 1,
      requeued: 0,
    });
  });

  it("counts a row suppressed between claim and send as suppressed, not sent", async () => {
    mock(claimBatch).mockResolvedValue([row()]);
    mock(isSuppressed).mockResolvedValueOnce(true);

    const result = await runEmailWorker();

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      suppressed: 1,
      requeued: 0,
    });
    expect(nm.sendMail).not.toHaveBeenCalled();
  });

  it("never throws when the transport cannot be built", async () => {
    mock(claimBatch).mockResolvedValue([row(), row({ id: 2 })]);
    nm.createTransport.mockImplementationOnce(() => {
      throw new Error("no SMTP host");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runEmailWorker();

    expect(result).toEqual({
      claimed: 2,
      sent: 0,
      failed: 2,
      suppressed: 0,
      requeued: 0,
    });
    expect(markFailed).toHaveBeenCalledTimes(2);
    expect(markFailed).toHaveBeenLastCalledWith(
      2,
      expect.stringContaining("no SMTP host"),
      { retryable: true },
    );
    spy.mockRestore();
  });

  it("does not open a transport for an empty queue", async () => {
    const result = await runEmailWorker({ limit: 5 });

    expect(result).toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
      suppressed: 0,
      requeued: 0,
    });
    expect(claimBatch).toHaveBeenCalledWith(5);
    expect(nm.createTransport).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/email/send", () => {
  const url = "http://localhost/api/internal/email/send";

  it("401s without the internal token", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(new Request(url, { method: "POST" }));

    expect(res.status).toBe(401);
    expect(claimBatch).not.toHaveBeenCalled();
  });

  it("returns the worker counts with a valid token", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    mock(claimBatch).mockResolvedValue([row()]);

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-lixto-internal-token": "s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 3 }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      suppressed: 0,
      requeued: 0,
    });
    expect(claimBatch).toHaveBeenCalledWith(3);
  });

  it("rejects a non-numeric limit", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-lixto-internal-token": "s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: "todos" }),
      }),
    );

    expect(res.status).toBe(400);
    expect(claimBatch).not.toHaveBeenCalled();
  });
});
