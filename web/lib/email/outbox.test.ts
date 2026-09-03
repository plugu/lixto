import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative import (not "@/lib/...") on purpose: vitest runs without path
// aliases. The pool is mocked — these tests never touch a live database.
vi.mock("../db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "../db";
import {
  BACKOFF_MINUTES,
  claimBatch,
  emailStats,
  enqueue,
  isSuppressed,
  markFailed,
  markSent,
  MAX_ATTEMPTS,
  nextRetryMinutes,
  normalizeEmail,
  suppress,
} from "./outbox";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

/** `{ rows }` shaped like pg's QueryResult, only as far as this module reads. */
function result(rows: unknown[], rowCount = rows.length) {
  return { rows, rowCount };
}

/** A full outbox row as pg returns it: bigints as strings. */
function rawMessage(over: Record<string, unknown> = {}) {
  return {
    id: "7",
    to_email: "user@example.com",
    company_id: "3",
    user_id: "11",
    template: "welcome",
    payload: {},
    subject: null,
    status: "sending",
    attempts: "1",
    last_error: null,
    message_id: null,
    dedupe_key: null,
    scheduled_for: new Date("2026-09-03T08:00:00Z"),
    sent_at: null,
    created_at: new Date("2026-09-03T07:59:00Z"),
    updated_at: new Date("2026-09-03T08:00:00Z"),
    ...over,
  };
}

/** The SQL text of the nth call (0-based). */
function sql(call: number): string {
  return query.mock.calls[call][0] as string;
}

/** The bound values of the nth call (0-based). */
function values(call: number): unknown[] {
  return query.mock.calls[call][1] as unknown[];
}

beforeEach(() => {
  query.mockReset();
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });
});

describe("nextRetryMinutes", () => {
  it("follows BACKOFF_MINUTES by the attempt that just failed", () => {
    expect(nextRetryMinutes(1)).toBe(BACKOFF_MINUTES[0]);
    expect(nextRetryMinutes(2)).toBe(BACKOFF_MINUTES[1]);
    expect(nextRetryMinutes(3)).toBe(BACKOFF_MINUTES[2]);
    expect(nextRetryMinutes(4)).toBe(BACKOFF_MINUTES[3]);
  });

  it("gives up at MAX_ATTEMPTS", () => {
    expect(nextRetryMinutes(MAX_ATTEMPTS)).toBe(null);
    expect(nextRetryMinutes(MAX_ATTEMPTS + 1)).toBe(null);
  });
});

describe("enqueue", () => {
  it("lowercases the address and binds every value", async () => {
    query
      .mockResolvedValueOnce(result([])) // suppression check
      .mockResolvedValueOnce(result([{ id: "42" }]));

    const scheduledFor = new Date("2026-09-04T09:00:00Z");
    const out = await enqueue({
      toEmail: "  Alex@Example.COM ",
      template: "welcome",
      payload: { name: "Alex" },
      companyId: 3,
      userId: 11,
      dedupeKey: null,
      scheduledFor,
    });

    expect(out).toEqual({ id: 42 });
    expect(values(0)[0]).toBe("alex@example.com");
    expect(sql(1)).toContain("INSERT INTO email_messages");
    expect(sql(1)).not.toContain("alex@example.com");
    expect(values(1)).toEqual([
      "alex@example.com",
      3,
      11,
      "welcome",
      JSON.stringify({ name: "Alex" }),
      null,
      scheduledFor,
    ]);
  });

  it("defaults payload, ids, dedupe key and schedule", async () => {
    query
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ id: 1 }]));

    await enqueue({ toEmail: "a@b.com", template: "invite" });

    expect(values(1)).toEqual(["a@b.com", null, null, "invite", "{}", null, null]);
    expect(sql(1)).toContain("COALESCE($7::timestamptz, now())");
  });

  it("skips a suppressed address without inserting", async () => {
    query.mockResolvedValueOnce(result([{ email: "a@b.com" }]));

    const out = await enqueue({ toEmail: "A@B.com", template: "daily_digest" });

    expect(out).toEqual({ id: null, skipped: "suppressed" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(sql(0)).toContain("FROM email_suppressions");
  });

  it("reports a repeated dedupe key as a duplicate", async () => {
    query
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([])); // ON CONFLICT DO NOTHING → no row

    const out = await enqueue({
      toEmail: "a@b.com",
      template: "daily_digest",
      dedupeKey: "daily_digest:3:2026-09-03",
    });

    expect(out).toEqual({ id: null, skipped: "duplicate" });
    // Partial index → the predicate must be repeated for inference.
    expect(sql(1)).toContain(
      "ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING",
    );
    expect(values(1)[5]).toBe("daily_digest:3:2026-09-03");
  });

  it("uses the caller's transaction client when given one", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(result([]))
        .mockResolvedValueOnce(result([{ id: "9" }])),
    };

    const out = await enqueue({ toEmail: "a@b.com", template: "welcome" }, client);

    expect(out).toEqual({ id: 9 });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("claimBatch", () => {
  it("claims with FOR UPDATE SKIP LOCKED and counts the attempt", async () => {
    query.mockResolvedValueOnce(result([rawMessage()]));

    const rows = await claimBatch(25);

    expect(sql(0)).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql(0)).toContain("status = 'sending'");
    expect(sql(0)).toContain("attempts = attempts + 1");
    expect(sql(0)).toContain("scheduled_for <= now()");
    expect(values(0)).toEqual([25]);
    expect(rows[0].id).toBe(7);
    expect(rows[0].company_id).toBe(3);
    expect(rows[0].attempts).toBe(1);
  });

  it("normalizes a null company/user", async () => {
    query.mockResolvedValueOnce(
      result([rawMessage({ company_id: null, user_id: null })]),
    );

    const [row] = await claimBatch(1);

    expect(row.company_id).toBe(null);
    expect(row.user_id).toBe(null);
  });
});

describe("markSent", () => {
  it("stores the MTA message id and stamps sent_at", async () => {
    query.mockResolvedValueOnce(
      result([rawMessage({ status: "sent", message_id: "<abc@mail.lixto.com.br>" })]),
    );

    const row = await markSent(7, "<abc@mail.lixto.com.br>");

    expect(sql(0)).toContain("status = 'sent'");
    expect(sql(0)).toContain("sent_at = now()");
    expect(values(0)).toEqual([7, "<abc@mail.lixto.com.br>"]);
    expect(row?.message_id).toBe("<abc@mail.lixto.com.br>");
  });

  it("returns null for an unknown id", async () => {
    query.mockResolvedValueOnce(result([]));
    expect(await markSent(999, null)).toBe(null);
  });
});

describe("markFailed", () => {
  it("reschedules a retryable failure with the backoff for this attempt", async () => {
    query
      .mockResolvedValueOnce(result([{ attempts: "2" }]))
      .mockResolvedValueOnce(result([rawMessage({ status: "queued", attempts: "2" })]));

    const row = await markFailed(7, "451 try later", { retryable: true });

    expect(sql(1)).toContain("status = 'queued'");
    expect(sql(1)).toContain("make_interval(mins => $3::int)");
    expect(values(1)).toEqual([7, "451 try later", BACKOFF_MINUTES[1]]);
    expect(row?.status).toBe("queued");
  });

  it("retries by default", async () => {
    query
      .mockResolvedValueOnce(result([{ attempts: 1 }]))
      .mockResolvedValueOnce(result([rawMessage({ status: "queued" })]));

    await markFailed(7, "connection reset");

    expect(values(1)[2]).toBe(BACKOFF_MINUTES[0]);
  });

  it("gives up after MAX_ATTEMPTS", async () => {
    query
      .mockResolvedValueOnce(result([{ attempts: String(MAX_ATTEMPTS) }]))
      .mockResolvedValueOnce(result([rawMessage({ status: "failed" })]));

    const row = await markFailed(7, "451 try later", { retryable: true });

    expect(sql(1)).toContain("status = 'failed'");
    expect(sql(1)).not.toContain("make_interval");
    expect(values(1)).toEqual([7, "451 try later"]);
    expect(row?.status).toBe("failed");
  });

  it("fails immediately when the error is not retryable", async () => {
    query
      .mockResolvedValueOnce(result([{ attempts: "1" }]))
      .mockResolvedValueOnce(result([rawMessage({ status: "failed" })]));

    await markFailed(7, "550 no such user", { retryable: false });

    expect(sql(1)).toContain("status = 'failed'");
    expect(values(1)).toEqual([7, "550 no such user"]);
  });

  it("returns null for an unknown id without updating", async () => {
    query.mockResolvedValueOnce(result([]));

    expect(await markFailed(999, "gone")).toBe(null);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("suppress", () => {
  it("upserts the suppression and cascades to queued rows", async () => {
    query
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([], 4));

    const out = await suppress("Bounced@Example.com", "hard_bounce", "550 unknown");

    expect(sql(0)).toContain("INSERT INTO email_suppressions");
    expect(sql(0)).toContain("ON CONFLICT (email) DO UPDATE");
    expect(values(0)).toEqual([
      "bounced@example.com",
      "hard_bounce",
      "550 unknown",
    ]);

    expect(sql(1)).toContain("status = 'suppressed'");
    expect(sql(1)).toContain("AND status = 'queued'");
    expect(values(1)).toEqual(["bounced@example.com"]);
    expect(out).toEqual({
      email: "bounced@example.com",
      suppressedMessages: 4,
    });
  });

  it("defaults the detail to null", async () => {
    query.mockResolvedValueOnce(result([])).mockResolvedValueOnce(result([], 0));

    await suppress("a@b.com", "unsubscribe");

    expect(values(0)[2]).toBe(null);
  });
});

describe("isSuppressed", () => {
  it("normalizes the address and reports the hit", async () => {
    query.mockResolvedValueOnce(result([{ email: "a@b.com" }]));
    expect(await isSuppressed("A@B.COM")).toBe(true);
    expect(values(0)).toEqual(["a@b.com"]);
  });

  it("is false when the address is absent", async () => {
    query.mockResolvedValueOnce(result([]));
    expect(await isSuppressed("a@b.com")).toBe(false);
  });
});

describe("emailStats", () => {
  it("returns the four counters as numbers", async () => {
    query.mockResolvedValueOnce(
      result([{ queued: "2", sent24h: "10", failed24h: "1", suppressed: "3" }]),
    );

    expect(await emailStats()).toEqual({
      queued: 2,
      sent24h: 10,
      failed24h: 1,
      suppressed: 3,
    });
    expect(sql(0)).toContain("FROM email_messages");
    expect(sql(0)).toContain("FROM email_suppressions");
  });

  it("falls back to zeros on an empty result", async () => {
    query.mockResolvedValueOnce(result([]));

    expect(await emailStats()).toEqual({
      queued: 0,
      sent24h: 0,
      failed24h: 0,
      suppressed: 0,
    });
  });
});
