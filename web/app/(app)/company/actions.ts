"use server";

// Server action backing the /company profile form. Admin-only; companyId
// always comes from the session, never from the form.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { isValidCEP, isValidEmail } from "@/lib/br-validators";
import { COMPANY_SIZES, UF_LIST } from "@/lib/types";
import {
  replaceCnaes,
  updateCompany,
  validateCnaes,
  type CnaeInput,
  type CompanyInput,
} from "@/lib/company-queries";

export type CompanyActionState = {
  ok?: boolean;
  error?: string;
};

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function updateCompanyAction(
  _prev: CompanyActionState,
  formData: FormData,
): Promise<CompanyActionState> {
  const session = await requireAdmin();

  const legalName = field(formData, "legalName");
  if (!legalName) {
    return { error: "Razão social é obrigatória." };
  }

  const postalCode = field(formData, "postalCode");
  if (postalCode && !isValidCEP(postalCode)) {
    return { error: "CEP inválido." };
  }

  const state = field(formData, "state");
  if (state && !UF_LIST.includes(state.toUpperCase())) {
    return { error: "UF inválida." };
  }

  const size = field(formData, "size");
  if (size && !(COMPANY_SIZES as string[]).includes(size)) {
    return { error: "Porte inválido." };
  }

  const email = field(formData, "email");
  if (email && !isValidEmail(email)) {
    return { error: "E-mail inválido." };
  }

  let cnaes: CnaeInput[];
  try {
    const raw = field(formData, "cnaes");
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) throw new Error("Formato de CNAEs inválido.");
    cnaes = parsed.map(
      (c: { code: string; description: string; isPrimary: boolean }) => ({
        code: String(c.code ?? ""),
        description: String(c.description ?? ""),
        isPrimary: Boolean(c.isPrimary),
      }),
    );
    validateCnaes(cnaes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "CNAEs inválidos.";
    return { error: message };
  }

  const input: CompanyInput = {
    legalName,
    tradeName: field(formData, "tradeName"),
    legalNature: field(formData, "legalNature"),
    size,
    simplesOptant: formData.get("simplesOptant") === "on",
    stateRegistration: field(formData, "stateRegistration"),
    municipalRegistration: field(formData, "municipalRegistration"),
    postalCode,
    street: field(formData, "street"),
    streetNumber: field(formData, "streetNumber"),
    addressLine2: field(formData, "addressLine2"),
    district: field(formData, "district"),
    cityName: field(formData, "cityName"),
    state,
    phone: field(formData, "phone"),
    email,
  };

  await updateCompany(session.company.id, input);
  await replaceCnaes(session.company.id, cnaes);

  revalidatePath("/company");
  return { ok: true };
}
