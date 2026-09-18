import { describe, expect, it } from "vitest";
import {
  buildListCompaniesByStatus,
  buildSetApprovalStatus,
} from "./company-approval-queries";

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
