// CNPJ lookup against BrasilAPI, used to autofill the signup form (ticket
// 25). Pure-ish: takes a fetch implementation so it's testable without a
// network dependency. Any failure (404, timeout, network error, bad shape)
// resolves to null — the signup form falls back to manual entry.

import type { Porte } from "./tenant-types";

export type CnpjCnae = {
  codigo: string;
  descricao: string;
  principal: boolean;
};

export type CnpjLookup = {
  razaoSocial: string;
  nomeFantasia: string | null;
  naturezaJuridica: string | null;
  porte: Porte | null;
  optanteSimples: boolean;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  cnaes: CnpjCnae[];
};

const LOOKUP_TIMEOUT_MS = 6000;

type BrasilApiCnaeSecundario = {
  codigo: number | string;
  descricao: string;
};

type BrasilApiCnpjResponse = {
  razao_social: string;
  nome_fantasia?: string | null;
  natureza_juridica?: string | null;
  porte?: string | null;
  opcao_pelo_mei?: boolean | null;
  opcao_pelo_simples?: boolean | null;
  cep?: string | number | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  ddd_telefone_1?: string | null;
  email?: string | null;
  cnae_fiscal?: number | string | null;
  cnae_fiscal_descricao?: string | null;
  cnaes_secundarios?: BrasilApiCnaeSecundario[] | null;
};

function mapPorte(data: BrasilApiCnpjResponse): Porte | null {
  if (data.opcao_pelo_mei === true) return "MEI";
  switch (data.porte) {
    case "MICRO EMPRESA":
      return "ME";
    case "EMPRESA DE PEQUENO PORTE":
      return "EPP";
    case "DEMAIS":
      return "MEDIO";
    default:
      return null;
  }
}

function padCnaeCodigo(codigo: number | string): string {
  return String(codigo).padStart(7, "0");
}

function mapResponse(data: BrasilApiCnpjResponse): CnpjLookup {
  const cnaes: CnpjCnae[] = [];
  if (data.cnae_fiscal != null && data.cnae_fiscal_descricao) {
    cnaes.push({
      codigo: padCnaeCodigo(data.cnae_fiscal),
      descricao: data.cnae_fiscal_descricao,
      principal: true,
    });
  }
  for (const secundario of data.cnaes_secundarios ?? []) {
    cnaes.push({
      codigo: padCnaeCodigo(secundario.codigo),
      descricao: secundario.descricao,
      principal: false,
    });
  }

  return {
    razaoSocial: data.razao_social,
    nomeFantasia: data.nome_fantasia ?? null,
    naturezaJuridica: data.natureza_juridica ?? null,
    porte: mapPorte(data),
    optanteSimples: data.opcao_pelo_simples === true,
    cep: data.cep != null ? String(data.cep) : null,
    logradouro: data.logradouro ?? null,
    numero: data.numero ?? null,
    complemento: data.complemento ?? null,
    bairro: data.bairro ?? null,
    municipio: data.municipio ?? null,
    uf: data.uf ?? null,
    telefone: data.ddd_telefone_1 ?? null,
    email: data.email ?? null,
    cnaes,
  };
}

/** Looks up a CNPJ against BrasilAPI. Returns null on any failure (404,
 * timeout, network error) so callers can fall back to manual entry. */
export async function lookupCNPJ(
  cnpjDigits: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CnpjLookup | null> {
  try {
    const res = await fetchImpl(
      `https://brasilapi.com.br/api/cnpj/v1/${cnpjDigits}`,
      {
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        // BrasilAPI 403s Node's default undici "node" User-Agent; identify
        // as a browser-ish client instead so real lookups succeed.
        headers: { "User-Agent": "Mozilla/5.0 plataforma-licitante" },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as BrasilApiCnpjResponse;
    if (!data || typeof data.razao_social !== "string") return null;
    return mapResponse(data);
  } catch {
    return null;
  }
}
