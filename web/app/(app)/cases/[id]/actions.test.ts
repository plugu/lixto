import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock hoists above these imports; every dependency the action touches is
// mocked (same pattern as web/app/(app)/admin/companies/actions.test.ts) so
// the module graph never opens a real connection or reads cookies.
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/case-queries", () => ({
  decideCase: vi.fn(),
  setOutcomeByOperator: vi.fn(),
}));
vi.mock("@/lib/opportunity-queries", () => ({
  insertFeedback: vi.fn(),
  setOpportunityState: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireSession } from "@/lib/auth";
import { decideCase, setOutcomeByOperator } from "@/lib/case-queries";
import { insertFeedback, setOpportunityState } from "@/lib/opportunity-queries";
import { revalidatePath } from "next/cache";
import { decideCaseAction, markDisqualifiedAction } from "./actions";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const SESSION = {
  user: {
    id: 9,
    name: "Owner",
    email: "owner@example.com",
    role: "admin" as const,
    companyId: 1,
    isSuperadmin: false,
  },
  company: {
    id: 1,
    legalName: "Lixto",
    tradeName: null,
    taxId: "00000000000000",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mock(requireSession).mockResolvedValue(SESSION);
});

describe("invalid input", () => {
  it("rejects a decision outside submit|skip|missing_document", async () => {
    const result = await decideCaseAction(1, "maybe", null);
    expect(result).toEqual({ error: "Escolha uma resposta." });
    expect(decideCase).not.toHaveBeenCalled();
  });

  it("rejects missing_document without a note", async () => {
    const result = await decideCaseAction(1, "missing_document", null);
    expect(result).toEqual({ error: "Diga qual documento falta." });
    expect(decideCase).not.toHaveBeenCalled();
  });

  it("rejects missing_document with a whitespace-only note", async () => {
    const result = await decideCaseAction(1, "missing_document", "   ");
    expect(result).toEqual({ error: "Diga qual documento falta." });
    expect(decideCase).not.toHaveBeenCalled();
  });

  it("rejects missing_document with a note over 200 chars", async () => {
    const result = await decideCaseAction(
      1,
      "missing_document",
      "a".repeat(201),
    );
    expect(result).toEqual({ error: "Diga qual documento falta." });
    expect(decideCase).not.toHaveBeenCalled();
  });

  it("accepts a missing_document note at exactly 200 chars", async () => {
    mock(decideCase).mockResolvedValue({ opportunity_id: 55 });
    const note = "a".repeat(200);

    const result = await decideCaseAction(1, "missing_document", note);

    expect(result).toEqual({ ok: true });
    expect(decideCase).toHaveBeenCalledWith(1, 1, 9, "missing_document", note);
  });
});

describe("not found", () => {
  it("returns an error when decideCase finds no ready case", async () => {
    mock(decideCase).mockResolvedValue(null);

    const result = await decideCaseAction(1, "submit", null);

    expect(result).toEqual({ error: "Caso não encontrado ou já decidido." });
    expect(insertFeedback).not.toHaveBeenCalled();
    expect(setOpportunityState).not.toHaveBeenCalled();
  });
});

describe("skip", () => {
  it("writes rejected feedback, dismisses the opportunity, and revalidates", async () => {
    mock(decideCase).mockResolvedValue({ opportunity_id: 55 });

    const result = await decideCaseAction(1, "skip", null);

    expect(result).toEqual({ ok: true });
    expect(decideCase).toHaveBeenCalledWith(1, 1, 9, "skip", null);
    expect(insertFeedback).toHaveBeenCalledWith(
      1,
      55,
      9,
      "rejected",
      "caso:nao_vou",
    );
    expect(setOpportunityState).toHaveBeenCalledWith(1, 55, "dismissed");
    expect(revalidatePath).toHaveBeenCalledWith("/cases");
    expect(revalidatePath).toHaveBeenCalledWith("/cases/1");
  });
});

describe("submit", () => {
  it("writes participated feedback without touching opportunity state", async () => {
    mock(decideCase).mockResolvedValue({ opportunity_id: 55 });

    const result = await decideCaseAction(1, "submit", null);

    expect(result).toEqual({ ok: true });
    expect(decideCase).toHaveBeenCalledWith(1, 1, 9, "submit", null);
    expect(insertFeedback).toHaveBeenCalledWith(
      1,
      55,
      9,
      "participated",
      "caso:vou_enviar",
    );
    expect(setOpportunityState).not.toHaveBeenCalled();
  });
});

describe("missing_document", () => {
  it("trims the note, persists it, and writes no feedback", async () => {
    mock(decideCase).mockResolvedValue({ opportunity_id: 55 });

    const result = await decideCaseAction(
      1,
      "missing_document",
      "  Certidão FGTS  ",
    );

    expect(result).toEqual({ ok: true });
    expect(decideCase).toHaveBeenCalledWith(
      1,
      1,
      9,
      "missing_document",
      "Certidão FGTS",
    );
    expect(insertFeedback).not.toHaveBeenCalled();
    expect(setOpportunityState).not.toHaveBeenCalled();
  });
});

describe("markDisqualifiedAction", () => {
  it("writes disqualified feedback and revalidates on a submitted case", async () => {
    mock(setOutcomeByOperator).mockResolvedValue({ opportunity_id: 55 });

    const result = await markDisqualifiedAction(1);

    expect(result).toEqual({ ok: true });
    expect(setOutcomeByOperator).toHaveBeenCalledWith(1, 1);
    expect(insertFeedback).toHaveBeenCalledWith(
      1,
      55,
      9,
      "disqualified",
      "caso:operador",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/cases");
    expect(revalidatePath).toHaveBeenCalledWith("/cases/1");
  });

  it("returns an error when the case is not found or never answered submit", async () => {
    mock(setOutcomeByOperator).mockResolvedValue(null);

    const result = await markDisqualifiedAction(1);

    expect(result).toEqual({
      error: "Caso não encontrado ou sem resposta 'Vou enviar'.",
    });
    expect(insertFeedback).not.toHaveBeenCalled();
  });
});
