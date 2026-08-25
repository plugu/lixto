"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import {
  isValidCEP,
  isValidCNPJ,
  isValidCPF,
  isValidEmail,
  onlyDigits,
} from "@/lib/br-validators";
import { lookupCNPJ } from "@/lib/cnpj-lookup";
import { createCompanyWithAdmin } from "@/lib/signup-queries";
import { COMPANY_SIZES, UF_LIST, type CompanySize } from "@/lib/types";
// COMPAT (ticket 80): lib/cnpj-lookup.ts is not owned by this ticket and
// still speaks the legacy `Porte` union — mapped to CompanySize right here,
// at the boundary. Ticket 82 ports cnpj-lookup itself.
import type { Porte } from "@/lib/tenant-types";

export type SignupState = {
  erro: string | null;
};

export type CompanyLookup = {
  legalName: string;
  tradeName: string | null;
  legalNature: string | null;
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
  cnaes: { code: string; description: string; isPrimary: boolean }[];
};

const SIZE_BY_PORTE: Record<Porte, CompanySize> = {
  MEI: "MEI",
  ME: "ME",
  EPP: "EPP",
  MEDIO: "MEDIUM",
  GRANDE: "LARGE",
};

/** Server-action wrapper around `lookupCNPJ` — the client form calls this
 * directly (no API route: `proxy.ts` blocks `/api/*` without a cookie). */
export async function lookupAction(
  taxId: string,
): Promise<CompanyLookup | null> {
  if (!isValidCNPJ(taxId)) return null;
  const found = await lookupCNPJ(onlyDigits(taxId));
  if (!found) return null;
  return {
    legalName: found.razaoSocial,
    tradeName: found.nomeFantasia,
    legalNature: found.naturezaJuridica,
    size: found.porte ? SIZE_BY_PORTE[found.porte] : null,
    simplesOptant: found.optanteSimples,
    postalCode: found.cep,
    street: found.logradouro,
    streetNumber: found.numero,
    addressLine2: found.complemento,
    district: found.bairro,
    cityName: found.municipio,
    state: found.uf,
    phone: found.telefone,
    email: found.email,
    cnaes: found.cnaes.map((c) => ({
      code: c.codigo,
      description: c.descricao,
      isPrimary: c.principal,
    })),
  };
}

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isCompanySize(value: string): value is CompanySize {
  return (COMPANY_SIZES as string[]).includes(value);
}

type CnaeForm = {
  code: string;
  description: string;
  isPrimary: boolean;
};

function parseCnaes(formData: FormData): CnaeForm[] {
  const codes = formData.getAll("cnae_code").map(String);
  const descriptions = formData.getAll("cnae_description").map(String);
  const primaryIndex = formData.get("cnae_primary");
  const primaryIdx =
    typeof primaryIndex === "string" ? Number(primaryIndex) : -1;

  return codes
    .map((code, i) => ({
      code: code.trim(),
      description: (descriptions[i] ?? "").trim(),
      isPrimary: i === primaryIdx,
    }))
    .filter((c) => c.code && c.description);
}

export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const taxId = str(formData, "taxId");
  const legalName = str(formData, "legalName");
  const tradeName = str(formData, "tradeName");
  const legalNature = str(formData, "legalNature");
  const sizeRaw = str(formData, "size");
  const simplesOptant = formData.get("simplesOptant") === "on";
  const stateRegistration = str(formData, "stateRegistration");
  const municipalRegistration = str(formData, "municipalRegistration");
  const postalCode = str(formData, "postalCode");
  const street = str(formData, "street");
  const streetNumber = str(formData, "streetNumber");
  const addressLine2 = str(formData, "addressLine2");
  const district = str(formData, "district");
  const cityName = str(formData, "cityName");
  const state = str(formData, "state");
  const companyPhone = str(formData, "companyPhone");
  const companyEmail = str(formData, "companyEmail");

  const name = str(formData, "name");
  const email = str(formData, "email");
  const password = str(formData, "password");
  const confirmPassword = str(formData, "confirmPassword");
  const cpf = str(formData, "cpf");
  const phone = str(formData, "phone");
  const jobTitle = str(formData, "jobTitle");

  const cnaes = parseCnaes(formData);

  if (!isValidCNPJ(taxId)) return { erro: "CNPJ inválido." };
  if (!legalName) return { erro: "Informe a razão social." };
  if (!isValidEmail(email)) return { erro: "E-mail inválido." };
  if (password.length < 8) {
    return { erro: "A senha deve ter ao menos 8 caracteres." };
  }
  if (password !== confirmPassword) return { erro: "As senhas não coincidem." };
  if (cpf && !isValidCPF(cpf)) return { erro: "CPF inválido." };
  if (postalCode && !isValidCEP(postalCode)) return { erro: "CEP inválido." };
  if (cnaes.length === 0) {
    return { erro: "Adicione ao menos um CNAE." };
  }
  const primaries = cnaes.filter((c) => c.isPrimary);
  if (primaries.length !== 1) {
    return { erro: "Selecione exatamente um CNAE principal." };
  }

  const size = isCompanySize(sizeRaw) ? sizeRaw : null;
  const stateValue = UF_LIST.includes(state) ? state : null;

  const passwordHash = await hashPassword(password);

  let result;
  try {
    result = await createCompanyWithAdmin({
      company: {
        taxId,
        legalName,
        tradeName: tradeName || null,
        legalNature: legalNature || null,
        size,
        simplesOptant,
        stateRegistration: stateRegistration || null,
        municipalRegistration: municipalRegistration || null,
        postalCode: postalCode || null,
        street: street || null,
        streetNumber: streetNumber || null,
        addressLine2: addressLine2 || null,
        district: district || null,
        cityName: cityName || null,
        state: stateValue,
        phone: companyPhone || null,
        email: companyEmail || null,
      },
      cnaes,
      user: {
        name,
        email,
        passwordHash,
        cpf: cpf || null,
        phone: phone || null,
        jobTitle: jobTitle || null,
      },
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return { erro: "CNPJ ou e-mail já cadastrado." };
    }
    throw err;
  }

  const token = await createSession(result.userId);
  await setSessionCookie(token);
  redirect("/company");
}
