import { describe, expect, it } from "vitest";
import {
  buildInsertCnaes,
  buildInsertEmpresa,
  buildInsertUsuario,
  type SignupEmpresaInput,
  type SignupUsuarioInput,
} from "./signup-queries";

const EMPRESA_INPUT: SignupEmpresaInput = {
  cnpj: "00.000.000/0001-91",
  razaoSocial: "BANCO DO BRASIL SA",
  nomeFantasia: "BB",
  naturezaJuridica: "206-2 - Sociedade de Economia Mista",
  porte: "GRANDE",
  optanteSimples: false,
  inscricaoEstadual: null,
  inscricaoMunicipal: null,
  cep: "70040-912",
  logradouro: "SAUN QUADRA 5",
  numero: "S/N",
  complemento: null,
  bairro: "ASA NORTE",
  municipio: "BRASILIA",
  uf: "DF",
  telefone: "6134938000",
  email: "Contato@BB.com.br",
};

describe("buildInsertEmpresa", () => {
  it("produces a parameterized INSERT with digits-only cnpj/cep and lowercased email", () => {
    const query = buildInsertEmpresa(EMPRESA_INPUT);

    expect(query.text).toContain("INSERT INTO empresa");
    expect(query.text).toContain("RETURNING id");
    expect(query.values[0]).toBe("00000000000191");
    expect(query.values[8]).toBe("70040912");
    expect(query.values[query.values.length - 1]).toBe("contato@bb.com.br");
  });

  it("passes through null optional fields untouched", () => {
    const query = buildInsertEmpresa({ ...EMPRESA_INPUT, cep: null, email: null });
    expect(query.values[8]).toBeNull();
    expect(query.values[query.values.length - 1]).toBeNull();
  });
});

describe("buildInsertCnaes", () => {
  it("flattens multiple cnae rows into a single multi-row INSERT", () => {
    const query = buildInsertCnaes(42, [
      { codigo: "6421200", descricao: "Bancos comerciais", principal: true },
      { codigo: "6422100", descricao: "Bancos múltiplos", principal: false },
    ]);

    expect(query.text).toContain("INSERT INTO empresa_cnae");
    expect(query.text).toMatch(/\(\$1, \$2, \$3, \$4\), \(\$1, \$5, \$6, \$7\)/);
    expect(query.values).toEqual([
      42,
      "6421200",
      "Bancos comerciais",
      true,
      "6422100",
      "Bancos múltiplos",
      false,
    ]);
  });

  it("returns an empty VALUES row set when given no cnaes", () => {
    const query = buildInsertCnaes(42, []);
    expect(query.values).toEqual([42]);
  });
});

describe("buildInsertUsuario", () => {
  const usuario: SignupUsuarioInput = {
    nome: "Ana Silva",
    email: "Ana@Empresa.com",
    senhaHash: "scrypt$abc$def",
    cpf: "111.444.777-35",
    telefone: "11999999999",
    cargo: "Diretora",
  };

  it("produces a parameterized INSERT with role admin, digits-only cpf and lowercased email", () => {
    const query = buildInsertUsuario(42, usuario);

    expect(query.text).toContain("INSERT INTO usuario");
    expect(query.text).toContain("'admin'");
    expect(query.values).toEqual([
      42,
      "ana@empresa.com",
      "scrypt$abc$def",
      "Ana Silva",
      "11144477735",
      "11999999999",
      "Diretora",
    ]);
  });

  it("keeps cpf null when not provided", () => {
    const query = buildInsertUsuario(42, { ...usuario, cpf: null });
    expect(query.values[4]).toBeNull();
  });
});
