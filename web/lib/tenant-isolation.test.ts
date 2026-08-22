import { describe, it, expect } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config file
import {
  buildUpdateEmpresa,
  buildInsertCnaes,
  type EmpresaInput,
  type CnaeInput,
} from "./empresa-queries";
import {
  buildListUsuarios,
  buildUpdateRole,
  buildRemoveUsuario,
} from "./usuario-queries";
import {
  buildListDocumentos,
  buildGetDocumento,
  buildDeleteDocumento,
  buildInsertDocumento,
  type NovoDocumento,
} from "./documento-queries";

const EMPRESA_ID = 42;
const USUARIO_ID = 1;
const DOC_ID = 7;

describe("Tenant isolation - all builders bind empresa_id", () => {
  it("buildUpdateEmpresa binds empresa_id as $1", () => {
    const input: EmpresaInput = {
      razaoSocial: "Test Company",
      nomeFantasia: "Test",
      naturezaJuridica: "Test",
      porte: "ME",
      optanteSimples: false,
      inscricaoEstadual: "123456789",
      inscricaoMunicipal: "987654321",
      cep: "01310100",
      logradouro: "Rua Test",
      numero: "123",
      complemento: "",
      bairro: "Centro",
      municipio: "São Paulo",
      uf: "SP",
      telefone: "1133334444",
      email: "test@example.com",
    };
    const { text, values } = buildUpdateEmpresa(EMPRESA_ID, input);

    // buildUpdateEmpresa uses WHERE id = $1 (empresaId is the id of the empresa table)
    expect(text).toContain("WHERE id = $1");
    expect(values[0]).toBe(EMPRESA_ID);
  });

  it("buildInsertCnaes binds empresa_id as $1 in column list", () => {
    const cnaes: CnaeInput[] = [
      { codigo: "6201501", descricao: "Consultoria", principal: true },
    ];
    const { text, values } = buildInsertCnaes(EMPRESA_ID, cnaes);

    // INSERT uses column list: (empresa_id, ...)
    expect(text).toContain("empresa_id");
    expect(values[0]).toBe(EMPRESA_ID);
  });

  it("buildListUsuarios binds empresa_id", () => {
    const { text, values } = buildListUsuarios(EMPRESA_ID);

    expect(/empresa_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(EMPRESA_ID);
  });

  it("buildUpdateRole binds empresa_id", () => {
    const { text, values } = buildUpdateRole(EMPRESA_ID, USUARIO_ID, "member");

    expect(/empresa_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(EMPRESA_ID);
  });

  it("buildRemoveUsuario binds empresa_id", () => {
    const { text, values } = buildRemoveUsuario(EMPRESA_ID, USUARIO_ID);

    expect(/empresa_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(EMPRESA_ID);
  });

  it("buildListDocumentos binds empresa_id", () => {
    const { text, values } = buildListDocumentos(EMPRESA_ID);

    expect(/empresa_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(EMPRESA_ID);
  });

  it("buildGetDocumento binds both id and empresa_id", () => {
    const { text, values } = buildGetDocumento(EMPRESA_ID, DOC_ID);

    expect(/id\s*=\s*\$/.test(text)).toBe(true);
    expect(/empresa_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(EMPRESA_ID);
    expect(values).toContain(DOC_ID);
  });

  it("buildDeleteDocumento binds empresa_id", () => {
    const { text, values } = buildDeleteDocumento(EMPRESA_ID, DOC_ID);

    expect(/empresa_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(EMPRESA_ID);
  });

  it("buildInsertDocumento binds empresa_id as $1 in column list", () => {
    const doc: NovoDocumento = {
      tipo: "contrato_social",
      nomeArquivo: "contrato.pdf",
      caminho: "42/uuid.pdf",
      mime: "application/pdf",
      tamanho: 1024,
      validade: "2026-12-31",
    };
    const { text, values } = buildInsertDocumento(EMPRESA_ID, USUARIO_ID, doc);

    // INSERT uses column list: (empresa_id, ...)
    expect(text).toContain("empresa_id");
    expect(values[0]).toBe(EMPRESA_ID);
  });
});
