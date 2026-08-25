import { describe, expect, it, vi } from "vitest";
import { lookupCNPJ } from "./cnpj-lookup";

const FIXTURE = {
  razao_social: "BANCO DO BRASIL SA",
  nome_fantasia: "BB",
  natureza_juridica: "206-2 - Sociedade de Economia Mista",
  porte: "DEMAIS",
  opcao_pelo_mei: false,
  opcao_pelo_simples: false,
  cep: "70040912",
  logradouro: "SAUN QUADRA 5",
  numero: "S/N",
  complemento: "LOTE B TORRE I",
  bairro: "ASA NORTE",
  municipio: "BRASILIA",
  uf: "DF",
  ddd_telefone_1: "6134938000",
  email: "contato@bb.com.br",
  cnae_fiscal: 6421200,
  cnae_fiscal_descricao: "Bancos comerciais",
  cnaes_secundarios: [
    { codigo: 6422100, descricao: "Bancos múltiplos, com carteira comercial" },
  ],
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("lookupCNPJ", () => {
  it("maps a BrasilAPI fixture to CnpjLookup", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(FIXTURE));

    const result = await lookupCNPJ("00000000000191", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://brasilapi.com.br/api/cnpj/v1/00000000000191",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(result).toEqual({
      legalName: "BANCO DO BRASIL SA",
      tradeName: "BB",
      legalNature: "206-2 - Sociedade de Economia Mista",
      size: "MEDIUM",
      simplesOptant: false,
      postalCode: "70040912",
      street: "SAUN QUADRA 5",
      streetNumber: "S/N",
      addressLine2: "LOTE B TORRE I",
      district: "ASA NORTE",
      cityName: "BRASILIA",
      state: "DF",
      phone: "6134938000",
      email: "contato@bb.com.br",
      cnaes: [
        { code: "6421200", description: "Bancos comerciais", isPrimary: true },
        {
          code: "6422100",
          description: "Bancos múltiplos, com carteira comercial",
          isPrimary: false,
        },
      ],
    });
  });

  it("returns null on a 404 response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "not found" }, false, 404));

    expect(await lookupCNPJ("00000000000000", fetchImpl)).toBeNull();
  });

  it("returns null when fetch throws (network error / timeout)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));

    expect(await lookupCNPJ("00000000000191", fetchImpl)).toBeNull();
  });

  describe("size mapping", () => {
    const cases: [Record<string, unknown>, string | null][] = [
      [{ porte: "MICRO EMPRESA" }, "ME"],
      [{ porte: "EMPRESA DE PEQUENO PORTE" }, "EPP"],
      [{ porte: "DEMAIS" }, "MEDIUM"],
      [{ porte: "DESCONHECIDO" }, null],
      [{ porte: "DEMAIS", opcao_pelo_mei: true }, "MEI"],
    ];

    it.each(cases)("maps %o to %s", async (overrides, expected) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse({ ...FIXTURE, ...overrides }));

      const result = await lookupCNPJ("00000000000191", fetchImpl);
      expect(result?.size).toBe(expected);
    });
  });
});
