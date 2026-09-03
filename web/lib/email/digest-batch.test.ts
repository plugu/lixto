import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. Everything the batch talks to is mocked — no live database, and the
// digest computation itself is already covered by digest-queries.test.ts.
//
// `enqueue` is *not* a bare stub: migration 003's partial unique index on
// `dedupe_key` is the real guard against a duplicate digest, so a mock that
// always "succeeds" can't catch a colliding key (a second admin silently
// getting no mail). This fake outbox enforces the same uniqueness with a
// `Set`, so a colliding key surfaces here as a missing enqueue — exactly
// what the real index would do.
vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../digest-queries", () => ({ getDigest: vi.fn() }));
vi.mock("./outbox", () => ({ enqueue: vi.fn() }));
vi.mock("./unsubscribe", () => ({
  buildUnsubscribeUrl: vi.fn((email: string) => `https://lixto.com.br/email/unsubscribe?email=${email}`),
}));

import { pool } from "../db";
import { getDigest } from "../digest-queries";
import { enqueue } from "./outbox";
import type { EnqueueInput, EnqueueResult } from "./outbox";
import { buildUnsubscribeUrl } from "./unsubscribe";
import { runDigestBatch } from "./digest-batch";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const sanPauloDate = (date: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);

/**
 * Stands in for `email_messages` + its partial unique index on `dedupe_key`
 * (migration 003): a non-null key that's already present is a no-op
 * (`skipped: "duplicate"`), same as the real `ON CONFLICT DO NOTHING`.
 */
function fakeOutbox() {
  const seenKeys = new Set<string>();
  let nextId = 1;

  mock(enqueue).mockImplementation(async (input: EnqueueInput): Promise<EnqueueResult> => {
    if (input.dedupeKey != null) {
      if (seenKeys.has(input.dedupeKey)) {
        return { id: null, skipped: "duplicate" };
      }
      seenKeys.add(input.dedupeKey);
    }
    return { id: nextId++ };
  });

  return { seenKeys };
}

type Recipient = { company_id: string | number; company_name: string; email: string };

function mockRecipients(rows: Recipient[]) {
  query.mockResolvedValue({ rows });
}

function digest(over: Record<string, unknown> = {}) {
  return {
    run: { started_at: new Date(), finished_at: new Date(), counters: {} },
    newCount: 0,
    matchedCount: 0,
    attentionCount: 0,
    attention: [],
    ...over,
  };
}

function attentionRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    company_id: 1,
    procurement_id: 10,
    source_id: "12345678000199-1-000001/2026",
    state: "matched",
    score: 80,
    reasons: [],
    attention: true,
    computed_at: new Date(),
    description: "Aquisição de lápis",
    agency_name: "Prefeitura",
    state_uf: "RJ",
    city_name: "Rio de Janeiro",
    modality_name: "Pregão",
    estimated_value: "1000.00",
    proposal_closes_at: new Date("2026-09-30T12:00:00Z"),
    verdict: null,
    rationale: null,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
  mock(getDigest).mockReset();
  mock(enqueue).mockReset();
  mock(buildUnsubscribeUrl).mockClear();
  fakeOutbox();
});

describe("runDigestBatch", () => {
  it("skips a company whose digest has zero attention and zero matches", async () => {
    mockRecipients([{ company_id: 1, company_name: "Alfa", email: "admin@alfa.com" }]);
    mock(getDigest).mockResolvedValue(digest());

    const result = await runDigestBatch();

    expect(result).toEqual({ companies: 1, enqueued: 0, skipped: 1 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues one dated, deduped row per admin email for a company with attention", async () => {
    mockRecipients([
      { company_id: 1, company_name: "Alfa", email: "admin1@alfa.com" },
      { company_id: 1, company_name: "Alfa", email: "admin2@alfa.com" },
    ]);
    mock(getDigest).mockResolvedValue(
      digest({ newCount: 10, matchedCount: 3, attentionCount: 1, attention: [attentionRow()] }),
    );

    const today = sanPauloDate(new Date());
    const result = await runDigestBatch();

    // Both admins actually got enqueued — not just "called" — because the
    // fake outbox enforces the same uniqueness constraint as migration 003's
    // partial index. A key collision here (e.g. the old company-only key)
    // would return `skipped: "duplicate"` for the second admin and drop
    // `enqueued` to 1.
    expect(result).toEqual({ companies: 1, enqueued: 2, skipped: 0 });
    expect(enqueue).toHaveBeenCalledTimes(2);

    const calls = mock(enqueue).mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.toEmail)).toEqual(["admin1@alfa.com", "admin2@alfa.com"]);
    const keys = calls.map((c) => c.dedupeKey);
    expect(new Set(keys).size).toBe(2); // no collision between admins
    for (const call of calls) {
      expect(call.template).toBe("daily_digest");
      expect(call.companyId).toBe(1);
      expect(call.dedupeKey).toBe(`daily_digest:1:${call.toEmail}:${today}`);
    }
  });

  it("keys the same São Paulo civil date whether the run is at 22:00 or 08:30 BRT the next morning", async () => {
    mockRecipients([{ company_id: 1, company_name: "Alfa", email: "admin@alfa.com" }]);
    mock(getDigest).mockResolvedValue(
      digest({ matchedCount: 1, attentionCount: 1, attention: [attentionRow()] }),
    );

    // 22:00 BRT on 2026-09-10 is 2026-09-11T01:00:00Z — UTC has already
    // rolled to the 11th, but São Paulo is still on the 10th.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T01:00:00Z"));
    await runDigestBatch();
    const lateNightKey = mock(enqueue).mock.calls[0][0].dedupeKey as string;

    // The following morning's scheduled run, 08:30 BRT on 2026-09-11.
    vi.setSystemTime(new Date("2026-09-11T11:30:00Z"));
    await runDigestBatch();
    const nextMorningKey = mock(enqueue).mock.calls[1][0].dedupeKey as string;
    vi.useRealTimers();

    expect(lateNightKey).toBe("daily_digest:1:admin@alfa.com:2026-09-10");
    expect(nextMorningKey).toBe("daily_digest:1:admin@alfa.com:2026-09-11");
    expect(lateNightKey).not.toBe(nextMorningKey);
  });

  it("would surface the old company-only-key bug: a pre-seeded collision drops the second admin", async () => {
    mockRecipients([
      { company_id: 1, company_name: "Alfa", email: "admin1@alfa.com" },
      { company_id: 1, company_name: "Alfa", email: "admin2@alfa.com" },
    ]);
    mock(getDigest).mockResolvedValue(
      digest({ matchedCount: 1, attentionCount: 1, attention: [attentionRow()] }),
    );

    // Pre-seed both admins' real (per-recipient) keys as already claimed —
    // as if a previous run today already sent to each of them — so this run
    // must observe both collide and enqueue nothing new.
    const today = sanPauloDate(new Date());
    const { seenKeys } = fakeOutbox();
    seenKeys.add(`daily_digest:1:admin1@alfa.com:${today}`);
    seenKeys.add(`daily_digest:1:admin2@alfa.com:${today}`);

    const result = await runDigestBatch();

    expect(result.enqueued).toBe(0);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("maps at most the (already-capped) attention rows to the template's card shape", async () => {
    mockRecipients([{ company_id: 1, company_name: "Alfa", email: "admin@alfa.com" }]);
    // getDigest itself caps `attention` at ATTENTION_PREVIEW_LIMIT (5); the
    // batch trusts that and just maps whatever it gets.
    const rows = Array.from({ length: 5 }, (_, i) =>
      attentionRow({ source_id: `src-${i}`, score: 70 + i }),
    );
    mock(getDigest).mockResolvedValue(
      digest({ matchedCount: 8, attentionCount: 8, attention: rows }),
    );

    await runDigestBatch();

    const call = mock(enqueue).mock.calls[0][0];
    const attention = call.payload.attention as Array<Record<string, unknown>>;
    expect(attention.length).toBeLessThanOrEqual(5);
    expect(attention[0]).toEqual({
      sourceId: "src-0",
      description: "Aquisição de lápis",
      agency: "Prefeitura",
      state: "RJ",
      score: 70,
      closesAt: "2026-09-30T12:00:00.000Z",
      url: "https://lixto.com.br/procurement/src-0",
    });
  });

  it("builds the unsubscribe URL for each recipient's own address", async () => {
    mockRecipients([{ company_id: 1, company_name: "Alfa", email: "admin@alfa.com" }]);
    mock(getDigest).mockResolvedValue(digest({ matchedCount: 1, attentionCount: 0 }));

    await runDigestBatch();

    expect(buildUnsubscribeUrl).toHaveBeenCalledWith("admin@alfa.com");
    const call = mock(enqueue).mock.calls[0][0];
    expect(call.payload.unsubscribeUrl).toContain("admin@alfa.com");
  });

  it("passes companyId through to the recipient query", async () => {
    mockRecipients([]);

    await runDigestBatch({ companyId: 42 });

    expect(query).toHaveBeenCalledWith(expect.any(String), [42]);
  });

  it("counts multiple companies and mixes skipped with enqueued", async () => {
    mockRecipients([
      { company_id: 1, company_name: "Alfa", email: "a@alfa.com" },
      { company_id: 2, company_name: "Beta", email: "b@beta.com" },
    ]);
    mock(getDigest).mockImplementation(async (companyId: number) =>
      companyId === 1
        ? digest({ matchedCount: 2, attentionCount: 1, attention: [attentionRow()] })
        : digest(),
    );

    const result = await runDigestBatch();

    expect(result).toEqual({ companies: 2, enqueued: 1, skipped: 1 });
  });
});
