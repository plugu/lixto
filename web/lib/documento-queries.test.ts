import { describe, expect, it } from "vitest";
import {
  assertTipo,
  buildDeleteDocumento,
  buildGetDocumento,
  buildInsertDocumento,
  buildListDocumentos,
  type NovoDocumento,
} from "./documento-queries";

const EMPRESA_ID = 7;

const NOVO_DOCUMENTO: NovoDocumento = {
  tipo: "contrato_social",
  nomeArquivo: "contrato.pdf",
  caminho: "7/uuid.pdf",
  mime: "application/pdf",
  tamanho: 1234,
  validade: null,
};

describe("documento-queries builders bind empresa_id", () => {
  it("buildListDocumentos", () => {
    const query = buildListDocumentos(EMPRESA_ID);
    expect(query.text).toContain("empresa_id = $1");
    expect(query.values).toEqual([EMPRESA_ID]);
  });

  it("buildGetDocumento", () => {
    const query = buildGetDocumento(EMPRESA_ID, 42);
    expect(query.text).toContain("empresa_id = $1");
    expect(query.values).toEqual([EMPRESA_ID, 42]);
  });

  it("buildDeleteDocumento", () => {
    const query = buildDeleteDocumento(EMPRESA_ID, 42);
    expect(query.text).toContain("empresa_id = $1");
    expect(query.values).toEqual([EMPRESA_ID, 42]);
  });

  it("buildInsertDocumento", () => {
    const query = buildInsertDocumento(EMPRESA_ID, 3, NOVO_DOCUMENTO);
    expect(query.text).toContain("empresa_id");
    expect(query.values[0]).toBe(EMPRESA_ID);
  });
});

describe("buildListDocumentos", () => {
  it("computes vencido with CURRENT_DATE", () => {
    const query = buildListDocumentos(EMPRESA_ID);
    expect(query.text).toContain("CURRENT_DATE");
    expect(query.text).toContain("validade IS NOT NULL AND validade < CURRENT_DATE");
  });

  it("orders by tipo then created_at desc", () => {
    const query = buildListDocumentos(EMPRESA_ID);
    expect(query.text).toContain("ORDER BY tipo ASC, created_at DESC");
  });
});

describe("assertTipo", () => {
  it("accepts every DOCUMENTO_TIPOS value", () => {
    expect(() => assertTipo("contrato_social")).not.toThrow();
    expect(() => assertTipo("outros")).not.toThrow();
  });

  it("rejects a tipo not in DOCUMENTO_TIPOS", () => {
    expect(() => assertTipo("nao_existe")).toThrow(/inválido/i);
  });
});

describe("buildInsertDocumento rejects an invalid tipo", () => {
  it("throws before building the query", () => {
    expect(() =>
      buildInsertDocumento(EMPRESA_ID, 3, { ...NOVO_DOCUMENTO, tipo: "nao_existe" as never }),
    ).toThrow(/inválido/i);
  });
});
