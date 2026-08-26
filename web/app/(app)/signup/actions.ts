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

export type SignupState = {
  error: string | null;
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

/** Server-action wrapper around `lookupCNPJ` — the client form calls this
 * directly (no API route: `proxy.ts` blocks `/api/*` without a cookie).
 * `lookupCNPJ` already speaks the schema's field names, so this is a pass
 * through plus the CNPJ validation. */
export async function lookupAction(
  taxId: string,
): Promise<CompanyLookup | null> {
  if (!isValidCNPJ(taxId)) return null;
  const found = await lookupCNPJ(onlyDigits(taxId));
  if (!found) return null;
  return {
    legalName: found.legalName,
    tradeName: found.tradeName,
    legalNature: found.legalNature,
    size: found.size,
    simplesOptant: found.simplesOptant,
    postalCode: found.postalCode,
    street: found.street,
    streetNumber: found.streetNumber,
    addressLine2: found.addressLine2,
    district: found.district,
    cityName: found.cityName,
    state: found.state,
    phone: found.phone,
    email: found.email,
    cnaes: found.cnaes.map((c) => ({
      code: c.code,
      description: c.description,
      isPrimary: c.isPrimary,
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

/** Drops repeated CNAEs (same digits, regardless of formatting) before
 * insert — the DB has a UNIQUE (company_id, cnae_code) constraint and a
 * duplicate would otherwise surface as a raw 23505. Keeps the first
 * occurrence of each code. */
function dedupeCnaes(cnaes: CnaeForm[]): CnaeForm[] {
  const seen = new Set<string>();
  const result: CnaeForm[] = [];
  for (const c of cnaes) {
    const digits = onlyDigits(c.code);
    if (seen.has(digits)) continue;
    seen.add(digits);
    result.push(c);
  }
  return result;
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

  const cnaes = dedupeCnaes(parseCnaes(formData));

  if (!isValidCNPJ(taxId)) return { error: "CNPJ inválido." };
  if (!legalName) return { error: "Informe a razão social." };
  if (!isValidEmail(email)) return { error: "E-mail inválido." };
  if (password.length < 8) {
    return { error: "A senha deve ter ao menos 8 caracteres." };
  }
  if (password !== confirmPassword) return { error: "As senhas não coincidem." };
  if (cpf && !isValidCPF(cpf)) return { error: "CPF inválido." };
  if (postalCode && !isValidCEP(postalCode)) return { error: "CEP inválido." };
  if (cnaes.length === 0) {
    return { error: "Adicione ao menos um CNAE." };
  }
  const primaries = cnaes.filter((c) => c.isPrimary);
  if (primaries.length !== 1) {
    return { error: "Selecione exatamente um CNAE principal." };
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
    const pgErr = err as { code?: string; constraint?: string } | null;
    if (pgErr?.code === "23505") {
      // company_cnaes has UNIQUE (company_id, cnae_code) — Postgres' default
      // naming convention gives it this name. Dedup above should already
      // prevent this, but a normalized-code collision (different formatting,
      // same digits after normalizeCnaeCode's padding) can still slip through.
      if (pgErr.constraint === "company_cnaes_company_id_cnae_code_key") {
        return { error: "CNAE duplicado." };
      }
      return { error: "CNPJ ou e-mail já cadastrado." };
    }
    throw err;
  }

  const token = await createSession(result.userId);
  await setSessionCookie(token);
  redirect("/company");
}
