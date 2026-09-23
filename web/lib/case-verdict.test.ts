import { describe, expect, it } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a path
// alias for lib tests. lib/case-verdict.ts is pure — nothing is mocked here
// because nothing touches a database.
import type { AnalysisDate, AnalysisRequirement } from "./analysis-queries";
import type { DocumentRow } from "./document-queries";
import type { DocumentKind } from "./types";
import {
  checkStatus,
  computeChecks,
  mapRequirementKinds,
  normalizeText,
  resolveSessionAt,
  summarizeChecks,
} from "./case-verdict";

/** Midday on purpose: a zoned date key must not depend on whether the test
 * runner sits in UTC or in São Paulo. */
const SESSION = new Date("2026-10-01T15:00:00.000Z");
const TODAY = new Date("2026-09-01T15:00:00.000Z");

function req(over: Partial<AnalysisRequirement> = {}): AnalysisRequirement {
  return {
    sequence: 1,
    category: "fiscal_labor",
    title: "Regularidade com o FGTS",
    description: "Certificado de Regularidade do FGTS (CRF).",
    mandatory: true,
    severity: "high",
    statement_kind: "fact",
    confidence: "high",
    citations: [{ sequence: 1, page: 12 }],
    ...over,
  };
}

function doc(
  id: number,
  kind: DocumentKind,
  validUntil: Date | null,
  over: Partial<DocumentRow> = {},
): DocumentRow {
  return {
    id,
    company_id: 1,
    kind,
    file_name: `doc-${id}.pdf`,
    storage_path: `1/doc-${id}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    valid_until: validUntil,
    uploaded_by: 1,
    created_at: new Date("2026-08-01T12:00:00.000Z"),
    expired: false,
    ...over,
  };
}

function analysisDate(over: Partial<AnalysisDate> = {}): AnalysisDate {
  return {
    sequence: 1,
    kind: "session",
    label: "Sessão pública",
    occurs_at: SESSION,
    raw_text: "Sessão pública em 01/10/2026",
    confidence: "high",
    citations: [],
    ...over,
  };
}

/** Local midnight, exactly how `pg` hands back a DATE column. */
function validUntil(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

describe("normalizeText", () => {
  it("lowercases, strips accents and collapses whitespace", () => {
    expect(normalizeText("  Certidão   Negativa  de DÉBITOS  ")).toBe(
      "certidao negativa de debitos",
    );
  });

  it("keeps word boundaries usable after stripping accents", () => {
    expect(normalizeText("Aptidão")).toBe("aptidao");
  });
});

describe("mapRequirementKinds", () => {
  const kinds = (title: string, description = "") =>
    mapRequirementKinds({ title, description });

  it("maps the FGTS certificate", () => {
    expect(kinds("Certificado de Regularidade do FGTS (CRF)")).toEqual([
      "fgts_clearance",
    ]);
  });

  it("maps the labor clearance", () => {
    expect(kinds("Certidão Negativa de Débitos Trabalhistas (CNDT)")).toEqual([
      "labor_clearance",
    ]);
  });

  it("returns one kind per matching rule, in rule order", () => {
    expect(
      kinds("Prova de regularidade com a Fazenda Federal, Estadual e Municipal"),
    ).toEqual([
      "state_tax_clearance",
      "municipal_tax_clearance",
      "federal_tax_clearance",
    ]);
  });

  it("maps the technical capacity certificate", () => {
    expect(kinds("Atestado de capacidade técnica")).toEqual([
      "technical_capacity_certificate",
    ]);
  });

  it("returns nothing for a requirement no upload can satisfy", () => {
    expect(kinds("Certidão negativa de falência")).toEqual([]);
  });
});

describe("checkStatus", () => {
  it("prefers a dated valid document over an undated one", () => {
    const undated = doc(1, "fgts_clearance", null);
    const dated = doc(2, "fgts_clearance", validUntil(2026, 12, 31));

    const result = checkStatus(
      "fgts_clearance",
      [undated, dated],
      SESSION,
      TODAY,
    );

    expect(result.status).toBe("met");
    expect(result.document?.id).toBe(2);
  });

  it("prefers the latest validade among dated valid documents", () => {
    const soon = doc(1, "fgts_clearance", validUntil(2026, 10, 20));
    const later = doc(2, "fgts_clearance", validUntil(2026, 12, 31));

    expect(
      checkStatus("fgts_clearance", [soon, later], SESSION, TODAY).document?.id,
    ).toBe(2);
  });

  it("falls back to an undated document when no dated one is valid", () => {
    const stale = doc(1, "fgts_clearance", validUntil(2026, 8, 1));
    const undated = doc(2, "fgts_clearance", null);

    const result = checkStatus(
      "fgts_clearance",
      [stale, undated],
      SESSION,
      TODAY,
    );

    expect(result.status).toBe("met");
    expect(result.document?.id).toBe(2);
  });

  it("reports expiring when every candidate expires before the session", () => {
    const older = doc(1, "labor_clearance", validUntil(2026, 8, 1));
    const newer = doc(2, "labor_clearance", validUntil(2026, 9, 10));

    const result = checkStatus(
      "labor_clearance",
      [older, newer],
      SESSION,
      TODAY,
    );

    expect(result.status).toBe("expiring");
    expect(result.document?.id).toBe(2);
  });

  it("reports missing when the company uploaded nothing of that kind", () => {
    const result = checkStatus(
      "balance_sheet",
      [doc(1, "fgts_clearance", null)],
      SESSION,
      TODAY,
    );

    expect(result).toEqual({ status: "missing", document: null });
  });

  it("compares against today when there is no session date", () => {
    // Valid on 2026-09-01 (today), expired by the 2026-10-01 session.
    const document = doc(1, "fgts_clearance", validUntil(2026, 9, 10));

    expect(checkStatus("fgts_clearance", [document], null, TODAY).status).toBe(
      "met",
    );
    expect(
      checkStatus("fgts_clearance", [document], SESSION, TODAY).status,
    ).toBe("expiring");
  });
});

describe("computeChecks", () => {
  it("marks a non-checkable category manual even when the text matches a rule", () => {
    const checks = computeChecks(
      [
        req({
          category: "specification",
          title: "Atestado de capacidade técnica do fabricante",
        }),
      ],
      [],
      SESSION,
      TODAY,
    );

    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe("manual");
    expect(checks[0].document_kind).toBeNull();
  });

  it("marks a checkable requirement manual when no rule recognises it", () => {
    const checks = computeChecks(
      [
        req({
          category: "legal",
          title: "Certidão negativa de falência",
          description: "Emitida pelo distribuidor judicial da sede.",
        }),
      ],
      [],
      SESSION,
      TODAY,
    );

    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe("manual");
    expect(checks[0].document_kind).toBeNull();
  });

  it("emits one line per matched kind, in requirement order, carrying the citations", () => {
    const checks = computeChecks(
      [
        req({
          sequence: 2,
          category: "legal",
          title: "Prova de regularidade com a Fazenda Federal e Estadual",
          description: "",
        }),
        req({ sequence: 1 }),
      ],
      [doc(5, "fgts_clearance", validUntil(2026, 12, 31))],
      SESSION,
      TODAY,
    );

    expect(
      checks.map((c) => [c.requirement_sequence, c.document_kind, c.status]),
    ).toEqual([
      [1, "fgts_clearance", "met"],
      [2, "state_tax_clearance", "missing"],
      [2, "federal_tax_clearance", "missing"],
    ]);
    expect(checks[0].document_id).toBe(5);
    expect(checks[0].document_file_name).toBe("doc-5.pdf");
    expect(checks[0].citations).toEqual([{ sequence: 1, page: 12 }]);
    expect(checks[1].document_id).toBeNull();
  });
});

describe("resolveSessionAt", () => {
  it("prefers the dossier session over everything else", () => {
    const closes = new Date("2026-11-01T15:00:00.000Z");

    expect(
      resolveSessionAt(
        [analysisDate(), analysisDate({ sequence: 2, kind: "proposal_deadline" })],
        closes,
      ),
    ).toEqual({ at: SESSION, source: "dossier_session" });
  });

  it("ranks by confidence first, then by sequence", () => {
    const strong = new Date("2026-10-05T15:00:00.000Z");

    const result = resolveSessionAt(
      [
        analysisDate({ sequence: 1, confidence: "low" }),
        analysisDate({ sequence: 2, confidence: "high", occurs_at: strong }),
        analysisDate({
          sequence: 3,
          confidence: "high",
          occurs_at: new Date("2026-10-09T15:00:00.000Z"),
        }),
      ],
      null,
    );

    expect(result).toEqual({ at: strong, source: "dossier_session" });
  });

  it("skips a session whose date could not be parsed", () => {
    const deadline = new Date("2026-09-25T15:00:00.000Z");

    expect(
      resolveSessionAt(
        [
          analysisDate({ occurs_at: null }),
          analysisDate({
            sequence: 2,
            kind: "proposal_deadline",
            occurs_at: deadline,
          }),
        ],
        null,
      ),
    ).toEqual({ at: deadline, source: "dossier_proposal_deadline" });
  });

  it("falls back to the procurement's own closing date", () => {
    const closes = new Date("2026-11-01T15:00:00.000Z");

    expect(resolveSessionAt([], closes)).toEqual({
      at: closes,
      source: "procurement_closes_at",
    });
  });

  it("returns no date at all when nothing is known", () => {
    expect(resolveSessionAt([], null)).toEqual({ at: null, source: null });
  });
});

describe("summarizeChecks", () => {
  it("counts each status", () => {
    const checks = computeChecks(
      [
        req({ sequence: 1 }),
        req({
          sequence: 2,
          title: "Certidão Negativa de Débitos Trabalhistas",
          description: "",
        }),
        req({
          sequence: 3,
          category: "technical",
          title: "Atestado de capacidade técnica",
          description: "",
        }),
        req({
          sequence: 4,
          category: "participation",
          title: "Vedação a consórcio",
          description: "",
        }),
      ],
      [
        doc(1, "fgts_clearance", validUntil(2026, 12, 31)),
        doc(2, "technical_capacity_certificate", validUntil(2026, 8, 1)),
      ],
      SESSION,
      TODAY,
    );

    expect(summarizeChecks(checks)).toEqual({
      met: 1,
      expiring: 1,
      missing: 1,
      manual: 1,
    });
  });
});
