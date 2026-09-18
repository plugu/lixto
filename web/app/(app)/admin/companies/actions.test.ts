import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock hoists above these imports; every dependency the two server
// actions touch is mocked (same pattern as
// web/lib/email/callsites.test.ts) so the module graph never opens a real
// connection or reads cookies.
vi.mock("@/lib/auth", () => ({ requireSuperadmin: vi.fn() }));
vi.mock("@/lib/company-approval-queries", () => ({
  setApprovalStatus: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireSuperadmin } from "@/lib/auth";
import { setApprovalStatus } from "@/lib/company-approval-queries";
import { revalidatePath } from "next/cache";
import { approveCompanyAction, rejectCompanyAction } from "./actions";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const SESSION = {
  user: {
    id: 9,
    name: "Owner",
    email: "owner@example.com",
    role: "admin" as const,
    companyId: 1,
    isSuperadmin: true,
  },
  company: { id: 1, legalName: "Lixto", tradeName: null, taxId: "00000000000000" },
};

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(requireSuperadmin).mockResolvedValue(SESSION);
});

describe("gate before action", () => {
  it("approveCompanyAction never calls setApprovalStatus when requireSuperadmin throws", async () => {
    mock(requireSuperadmin).mockRejectedValue(new Error("not found"));

    await expect(
      approveCompanyAction(formData({ companyId: "42" })),
    ).rejects.toThrow("not found");

    expect(setApprovalStatus).not.toHaveBeenCalled();
  });

  it("rejectCompanyAction never calls setApprovalStatus when requireSuperadmin throws", async () => {
    mock(requireSuperadmin).mockRejectedValue(new Error("not found"));

    await expect(
      rejectCompanyAction(formData({ companyId: "42" })),
    ).rejects.toThrow("not found");

    expect(setApprovalStatus).not.toHaveBeenCalled();
  });
});

describe("approveCompanyAction", () => {
  it("maps companyId to a number, trims the reason, and uses the session user id as changedBy", async () => {
    await approveCompanyAction(formData({ companyId: "42", reason: "  ok  " }));

    expect(setApprovalStatus).toHaveBeenCalledWith(42, "approved", "ok", 9);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/companies");
  });

  it("maps an empty/whitespace reason to null", async () => {
    await approveCompanyAction(formData({ companyId: "42", reason: "   " }));
    expect(setApprovalStatus).toHaveBeenCalledWith(42, "approved", null, 9);
  });

  it("maps a missing reason field to null", async () => {
    await approveCompanyAction(formData({ companyId: "42" }));
    expect(setApprovalStatus).toHaveBeenCalledWith(42, "approved", null, 9);
  });
});

describe("rejectCompanyAction", () => {
  it("maps companyId to a number, trims the reason, and uses the session user id as changedBy", async () => {
    await rejectCompanyAction(
      formData({ companyId: "7", reason: " CNPJ inválido " }),
    );

    expect(setApprovalStatus).toHaveBeenCalledWith(
      7,
      "rejected",
      "CNPJ inválido",
      9,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/companies");
  });
});

describe("invalid input (F8/F14): throws instead of a silent no-op", () => {
  it("throws on a non-integer companyId without calling setApprovalStatus", async () => {
    await expect(
      approveCompanyAction(formData({ companyId: "not-a-number" })),
    ).rejects.toThrow("Empresa inválida.");
    expect(setApprovalStatus).not.toHaveBeenCalled();
  });

  it("throws on a zero/negative companyId without calling setApprovalStatus", async () => {
    await expect(
      approveCompanyAction(formData({ companyId: "0" })),
    ).rejects.toThrow("Empresa inválida.");
    expect(setApprovalStatus).not.toHaveBeenCalled();

    await expect(
      approveCompanyAction(formData({ companyId: "-1" })),
    ).rejects.toThrow("Empresa inválida.");
    expect(setApprovalStatus).not.toHaveBeenCalled();
  });

  it("throws on a reason over 500 chars without calling setApprovalStatus", async () => {
    const longReason = "a".repeat(501);
    await expect(
      rejectCompanyAction(formData({ companyId: "42", reason: longReason })),
    ).rejects.toThrow("Motivo muito longo (máx. 500 caracteres).");
    expect(setApprovalStatus).not.toHaveBeenCalled();
  });

  it("accepts a reason at exactly 500 chars", async () => {
    const reason = "a".repeat(500);
    await approveCompanyAction(formData({ companyId: "42", reason }));
    expect(setApprovalStatus).toHaveBeenCalledWith(42, "approved", reason, 9);
  });
});
