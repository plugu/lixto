"use server";

import { redirect } from "next/navigation";
import { hashPassword } from "@/lib/auth";
import {
  isValidCEP,
  isValidCNPJ,
  isValidCPF,
  isValidEmail,
  onlyDigits,
} from "@/lib/br-validators";
import { lookupCNPJ } from "@/lib/cnpj-lookup";
import { enqueue, type EnqueueInput } from "@/lib/email/outbox";
import { createCompanyWithAdmin } from "@/lib/signup-queries";
import {
  listSuperadminRecipients,
  type SuperadminRecipient,
} from "@/lib/superadmin-queries";
import { COMPANY_SIZES, UF_LIST, type CompanySize } from "@/lib/types";

const APP_URL = process.env.LIXTO_APP_URL ?? "https://lixto.com.br";

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

/** Payload for the "we received your signup" mail sent to the applicant —
 * split out so it is testable without invoking the full server action (which
 * pulls in `next/navigation`, `@/lib/auth` and DB-backed query modules).
 * `async` because this file is `"use server"`: every top-level export must
 * be a Server Action. */
export async function buildSignupReceivedInput(input: {
  name: string;
  email: string;
  tradeName: string;
  legalName: string;
  companyId: number;
  userId: number;
}): Promise<EnqueueInput> {
  return {
    toEmail: input.email,
    template: "signup_received",
    payload: {
      userName: input.name,
      companyName: input.tradeName || input.legalName,
    },
    companyId: input.companyId,
    userId: input.userId,
  };
}

/** Payload for the "new company awaiting approval" mail sent to one
 * superadmin — `userId` is the superadmin's own id (not the new company's
 * admin) so the outbox row still ties back to a real user. `companyId` is
 * `null` (F6): the recipient is a superadmin, not a member of the
 * applicant company, and the applicant company is already identified in
 * the payload (`companyName`/`taxId`) — tying the outbox row to it would
 * misrepresent whose company this mail belongs to. */
export async function buildPendingAdminInput(
  recipient: SuperadminRecipient,
  input: {
    companyName: string;
    taxId: string;
    adminName: string;
    adminEmail: string;
    companyId: number;
  },
): Promise<EnqueueInput> {
  return {
    toEmail: recipient.email,
    template: "signup_pending_admin",
    payload: {
      companyName: input.companyName,
      taxId: onlyDigits(input.taxId),
      adminName: input.adminName,
      adminEmail: input.adminEmail,
      adminUrl: `${APP_URL}/admin/companies`,
    },
    companyId: null,
    userId: recipient.id,
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

  try {
    await createCompanyWithAdmin(
      {
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
      },
      // Enqueued inside the transaction, before COMMIT (ADR 002 D1): a
      // rejecting enqueue rolls the signup back instead of leaving a user
      // with no confirmation mail — the user simply retries. Superadmin
      // recipients are read through `client` (not the default pool) so the
      // read sees the same transaction snapshot the insert just committed
      // into, and so a rollback of this hook also undoes nothing it
      // shouldn't have read in the first place.
      async ({ client, companyId, userId }) => {
        await enqueue(
          await buildSignupReceivedInput({
            name,
            email,
            tradeName,
            legalName,
            companyId,
            userId,
          }),
          client,
        );

        const superadmins = await listSuperadminRecipients(client);
        for (const recipient of superadmins) {
          await enqueue(
            await buildPendingAdminInput(recipient, {
              companyName: tradeName || legalName,
              taxId,
              adminName: name,
              adminEmail: email,
              companyId,
            }),
            client,
          );
        }
      },
    );
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

  // No session: the company starts `pending` (migration 007) and only gets
  // access once a superadmin approves it (ticket 158) — signing up must not
  // grant the applicant a working session in the meantime.
  redirect("/signup/recebido");
}
