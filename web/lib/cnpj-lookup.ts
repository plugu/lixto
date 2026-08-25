// CNPJ lookup against BrasilAPI, used to autofill the signup form (ticket
// 25). Pure-ish: takes a fetch implementation so it's testable without a
// network dependency. Any failure (404, timeout, network error, bad shape)
// resolves to null — the signup form falls back to manual entry.

import type { CompanySize } from "./types";

export type CnpjCnae = {
  code: string;
  description: string;
  isPrimary: boolean;
};

export type CnpjLookup = {
  legalName: string;
  tradeName: string | null;
  legalNature: string | null;
  /** Already the schema's `companies.size` union — no mapping at the caller. */
  size: CompanySize | null;
  simplesOptant: boolean;
  postalCode: string | null;
  street: string | null;
  streetNumber: string | null;
  addressLine2: string | null;
  district: string | null;
  cityName: string | null;
  state: string | null;
  phone: string | null;
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

/** BrasilAPI's `porte` string → `companies.size`. BrasilAPI has no "LARGE"
 * bucket (everything above EPP is "DEMAIS"), so MEDIUM is as precise as the
 * source gets; the user can correct it on the signup form. */
function mapSize(data: BrasilApiCnpjResponse): CompanySize | null {
  if (data.opcao_pelo_mei === true) return "MEI";
  switch (data.porte) {
    case "MICRO EMPRESA":
      return "ME";
    case "EMPRESA DE PEQUENO PORTE":
      return "EPP";
    case "DEMAIS":
      return "MEDIUM";
    default:
      return null;
  }
}

function padCnaeCode(code: number | string): string {
  return String(code).padStart(7, "0");
}

function mapResponse(data: BrasilApiCnpjResponse): CnpjLookup {
  const cnaes: CnpjCnae[] = [];
  if (data.cnae_fiscal != null && data.cnae_fiscal_descricao) {
    cnaes.push({
      code: padCnaeCode(data.cnae_fiscal),
      description: data.cnae_fiscal_descricao,
      isPrimary: true,
    });
  }
  for (const secondary of data.cnaes_secundarios ?? []) {
    cnaes.push({
      code: padCnaeCode(secondary.codigo),
      description: secondary.descricao,
      isPrimary: false,
    });
  }

  return {
    legalName: data.razao_social,
    tradeName: data.nome_fantasia ?? null,
    legalNature: data.natureza_juridica ?? null,
    size: mapSize(data),
    simplesOptant: data.opcao_pelo_simples === true,
    postalCode: data.cep != null ? String(data.cep) : null,
    street: data.logradouro ?? null,
    streetNumber: data.numero ?? null,
    addressLine2: data.complemento ?? null,
    district: data.bairro ?? null,
    cityName: data.municipio ?? null,
    state: data.uf ?? null,
    phone: data.ddd_telefone_1 ?? null,
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
