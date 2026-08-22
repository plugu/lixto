import { describe, expect, it } from "vitest";
import {
  buildInsertCnaes,
  buildUpdateEmpresa,
  validateCnaes,
  type CnaeInput,
  type EmpresaInput,
} from "./empresa-queries";

const baseInput: EmpresaInput = {
  razaoSocial: "Acme Ltda",
  nomeFantasia: "Acme",
  naturezaJuridica: "206-2 - Sociedade Empresária Limitada",
  porte: "ME",
  optanteSimples: true,
  inscricaoEstadual: "123456",
  inscricaoMunicipal: "654321",
  cep: "01310-100",
  logradouro: "Av. Paulista",
  numero: "1000",
  complemento: "Sala 1",
  bairro: "Bela Vista",
  municipio: "São Paulo",
  uf: "sp",
  telefone: "(11) 99999-0000",
  email: "contato@acme.com",
};

describe("buildUpdateEmpresa", () => {
  it("includes WHERE id = $1 with empresaId as the first value", () => {
    const { text, values } = buildUpdateEmpresa(42, baseInput);
    expect(text).toContain("WHERE id = $1");
    expect(values[0]).toBe(42);
  });

  it("strips non-digits from cep", () => {
    const { values } = buildUpdateEmpresa(1, baseInput);
    const cepIdx = values.findIndex((v) => v === "01310100");
    expect(cepIdx).toBeGreaterThan(-1);
  });

  it("uppercases uf", () => {
    const { values } = buildUpdateEmpresa(1, baseInput);
    expect(values).toContain("SP");
  });

  it("sets porte to null when the input is an empty string", () => {
    const { values } = buildUpdateEmpresa(1, { ...baseInput, porte: "" });
    // porte is the 5th SET column -> $5 -> values[4]
    expect(values[4]).toBeNull();
  });

  it("sets cep to null when the input is an empty string", () => {
    const { values } = buildUpdateEmpresa(1, { ...baseInput, cep: "" });
    expect(values[8]).toBeNull();
  });

  it("nulls out optional text fields left blank", () => {
    const { values } = buildUpdateEmpresa(1, {
      ...baseInput,
      nomeFantasia: "   ",
      complemento: "",
    });
    expect(values[2]).toBeNull(); // nome_fantasia
    expect(values[11]).toBeNull(); // complemento
  });
});

describe("buildInsertCnaes", () => {
  const cnaes: CnaeInput[] = [
    { codigo: "6201-5/01", descricao: "Desenvolvimento de software", principal: true },
    { codigo: "6202-3/00", descricao: "Consultoria em TI", principal: false },
  ];

  it("uses empresaId as $1 for every row", () => {
    const { text, values } = buildInsertCnaes(7, cnaes);
    expect(values[0]).toBe(7);
    expect(text).toContain("($1,");
  });

  it("flattens each cnae's codigo/descricao/principal into values, stripping codigo formatting", () => {
    const { values } = buildInsertCnaes(7, cnaes);
    expect(values).toEqual([
      7,
      "6201501",
      "Desenvolvimento de software",
      true,
      "6202300",
      "Consultoria em TI",
      false,
    ]);
  });
});

describe("validateCnaes", () => {
  it("throws when there are zero principal CNAEs", () => {
    expect(() =>
      validateCnaes([
        { codigo: "6201501", descricao: "Software", principal: false },
      ]),
    ).toThrow();
  });

  it("throws when there is more than one principal CNAE", () => {
    expect(() =>
      validateCnaes([
        { codigo: "6201501", descricao: "Software", principal: true },
        { codigo: "6202300", descricao: "Consultoria", principal: true },
      ]),
    ).toThrow();
  });

  it("does not throw when exactly one CNAE is principal", () => {
    expect(() =>
      validateCnaes([
        { codigo: "6201501", descricao: "Software", principal: true },
        { codigo: "6202300", descricao: "Consultoria", principal: false },
      ]),
    ).not.toThrow();
  });
});
