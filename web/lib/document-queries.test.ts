import { describe, expect, it } from "vitest";
import {
  assertKind,
  buildDeleteDocument,
  buildGetDocument,
  buildInsertDocument,
  buildListDocuments,
  type NewDocument,
} from "./document-queries";

const COMPANY_ID = 7;

const NEW_DOCUMENT: NewDocument = {
  kind: "articles_of_association",
  fileName: "contrato.pdf",
  storagePath: "7/uuid.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1234,
  validUntil: null,
};

describe("document-queries builders bind company_id", () => {
  it("buildListDocuments", () => {
    const query = buildListDocuments(COMPANY_ID);
    expect(query.text).toContain("company_id = $1");
    expect(query.values).toEqual([COMPANY_ID]);
  });

  it("buildGetDocument", () => {
    const query = buildGetDocument(COMPANY_ID, 42);
    expect(query.text).toContain("company_id = $1");
    expect(query.values).toEqual([COMPANY_ID, 42]);
  });

  it("buildDeleteDocument", () => {
    const query = buildDeleteDocument(COMPANY_ID, 42);
    expect(query.text).toContain("company_id = $1");
    expect(query.values).toEqual([COMPANY_ID, 42]);
  });

  it("buildInsertDocument", () => {
    const query = buildInsertDocument(COMPANY_ID, 3, NEW_DOCUMENT);
    expect(query.text).toContain("company_id");
    expect(query.values[0]).toBe(COMPANY_ID);
  });
});

describe("buildListDocuments", () => {
  it("computes expired with CURRENT_DATE", () => {
    const query = buildListDocuments(COMPANY_ID);
    expect(query.text).toContain("CURRENT_DATE");
    expect(query.text).toContain(
      "valid_until IS NOT NULL AND valid_until < CURRENT_DATE",
    );
  });

  it("orders by kind then created_at desc", () => {
    const query = buildListDocuments(COMPANY_ID);
    expect(query.text).toContain("ORDER BY kind ASC, created_at DESC");
  });
});

describe("assertKind", () => {
  it("accepts every DOCUMENT_KINDS value", () => {
    expect(() => assertKind("articles_of_association")).not.toThrow();
    expect(() => assertKind("other")).not.toThrow();
  });

  it("rejects a kind not in DOCUMENT_KINDS", () => {
    expect(() => assertKind("nao_existe")).toThrow(/inválido/i);
  });
});

describe("buildInsertDocument rejects an invalid kind", () => {
  it("throws before building the query", () => {
    expect(() =>
      buildInsertDocument(COMPANY_ID, 3, {
        ...NEW_DOCUMENT,
        kind: "nao_existe" as never,
      }),
    ).toThrow(/inválido/i);
  });
});
