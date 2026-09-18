import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ pool: { connect: vi.fn() } }));
vi.mock("./email/outbox", () => ({ enqueue: vi.fn() }));

import { pool } from "./db";
import { enqueue } from "./email/outbox";
import {
  buildListCompaniesByStatus,
  buildSetApprovalStatus,
  setApprovalStatus,
} from "./company-approval-queries";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe("buildListCompaniesByStatus", () => {
  it("binds the status and orders by created_at desc", () => {
    const query = buildListCompaniesByStatus("pending");
    expect(query.text).toMatch(/approval_status\s*=\s*\$1/);
    expect(query.text).toMatch(/ORDER BY c\.created_at DESC/);
    expect(query.values).toEqual(["pending"]);
  });

  it("left-joins the first admin via a lateral subquery", () => {
    const query = buildListCompaniesByStatus("approved");
    expect(query.text).toMatch(/LEFT JOIN LATERAL/);
    expect(query.text).toMatch(/role = 'admin'/);
    expect(query.text).toMatch(/ORDER BY id\s+LIMIT 1/);
  });

  it("selects the company columns the table needs", () => {
    const query = buildListCompaniesByStatus("rejected");
    for (const column of [
      "c.id",
      "c.tax_id",
      "c.legal_name",
      "c.trade_name",
      "c.city_name",
      "c.state",
      "c.created_at",
      "c.approval_reason",
      "c.approval_changed_at",
    ]) {
      expect(query.text).toContain(column);
    }
  });
});

describe("buildSetApprovalStatus", () => {
  it("binds companyId, status, reason and changedBy in order", () => {
    const query = buildSetApprovalStatus(42, "approved", null, 7);
    expect(query.values).toEqual([42, "approved", null, 7]);
  });

  it("passes a non-null reason through", () => {
    const query = buildSetApprovalStatus(42, "rejected", "CNPJ inválido", 7);
    expect(query.values).toEqual([42, "rejected", "CNPJ inválido", 7]);
  });

  it("targets the row by id and stamps approval_changed_at/updated_at", () => {
    const query = buildSetApprovalStatus(42, "approved", null, 7);
    expect(query.text).toMatch(/WHERE id\s*=\s*\$1/);
    expect(query.text).toMatch(/approval_changed_at\s*=\s*now\(\)/);
    expect(query.text).toMatch(/updated_at\s*=\s*now\(\)/);
  });

  it("returns legal_name and trade_name for the mail payload", () => {
    const query = buildSetApprovalStatus(42, "approved", null, 7);
    expect(query.text).toMatch(/RETURNING legal_name, trade_name/);
  });
});

/** Stub `PoolClient`: the UPDATE and the admin-lookup SELECT return canned
 * rows; every `query` call (plus `enqueue`, wired per-test) pushes onto
 * `order` so a test can assert BEGIN -> UPDATE -> enqueue -> COMMIT
 * sequencing instead of just that each call happened. */
function stubClient(order: string[]) {
  return {
    query: vi.fn(async (text: string) => {
      const sql = String(text).trim();
      if (sql.startsWith("BEGIN")) {
        order.push("BEGIN");
        return { rows: [] };
      }
      if (sql.startsWith("COMMIT")) {
        order.push("COMMIT");
        return { rows: [] };
      }
      if (sql.startsWith("ROLLBACK")) {
        order.push("ROLLBACK");
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE companies")) {
        order.push("UPDATE");
        return { rows: [{ legal_name: "Acme Ltda", trade_name: "Acme" }] };
      }
      order.push("SELECT admin");
      return { rows: [{ id: 7, name: "Ana", email: "ana@example.com" }] };
    }),
    release: vi.fn(),
  };
}

describe("setApprovalStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs BEGIN, UPDATE, enqueue on the tx client, then COMMIT, in order, and releases cleanly", async () => {
    const order: string[] = [];
    const client = stubClient(order);
    mock(pool.connect).mockResolvedValue(client);
    mock(enqueue).mockImplementation(async () => {
      order.push("enqueue");
      return { id: 1 };
    });

    await setApprovalStatus(42, "approved", null, 9);

    expect(order).toEqual([
      "BEGIN",
      "UPDATE",
      "SELECT admin",
      "enqueue",
      "COMMIT",
    ]);
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), client);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
  });

  it("rolls back, releases with the error, and rethrows when enqueue fails", async () => {
    const order: string[] = [];
    const client = stubClient(order);
    mock(pool.connect).mockResolvedValue(client);
    const boom = new Error("smtp down");
    mock(enqueue).mockRejectedValue(boom);

    await expect(setApprovalStatus(42, "approved", null, 9)).rejects.toThrow(
      "smtp down",
    );

    expect(order).toEqual(["BEGIN", "UPDATE", "SELECT admin", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(boom);
  });
});
