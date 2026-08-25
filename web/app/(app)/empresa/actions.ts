"use server";

// Server action backing the /empresa profile form (ticket 26). Admin-only;
// empresaId always comes from the session, never from the form.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { isValidCEP, isValidEmail } from "@/lib/br-validators";
import { UF_LIST } from "@/lib/tenant-types";
import {
  replaceCnaes,
  updateEmpresa,
  validateCnaes,
  type CnaeInput,
  type EmpresaInput,
} from "@/lib/empresa-queries";

export type EmpresaActionState = {
  ok?: boolean;
  erro?: string;
};

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function updateEmpresaAction(
  _prev: EmpresaActionState,
  formData: FormData,
): Promise<EmpresaActionState> {
  const session = await requireAdmin();

  const razaoSocial = field(formData, "razaoSocial");
  if (!razaoSocial) {
    return { erro: "Razão social é obrigatória." };
  }

  const cep = field(formData, "cep");
  if (cep && !isValidCEP(cep)) {
    return { erro: "CEP inválido." };
  }

  const uf = field(formData, "uf");
  if (uf && !UF_LIST.includes(uf.toUpperCase())) {
    return { erro: "UF inválida." };
  }

  const email = field(formData, "email");
  if (email && !isValidEmail(email)) {
    return { erro: "E-mail inválido." };
  }

  let cnaes: CnaeInput[];
  try {
    const raw = field(formData, "cnaes");
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) throw new Error("Formato de CNAEs inválido.");
    cnaes = parsed.map((c: { codigo: string; descricao: string; principal: boolean }) => ({
      codigo: String(c.codigo ?? ""),
      descricao: String(c.descricao ?? ""),
      principal: Boolean(c.principal),
    }));
    validateCnaes(cnaes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "CNAEs inválidos.";
    return { erro: message };
  }

  const input: EmpresaInput = {
    razaoSocial,
    nomeFantasia: field(formData, "nomeFantasia"),
    naturezaJuridica: field(formData, "naturezaJuridica"),
    porte: field(formData, "porte"),
    optanteSimples: formData.get("optanteSimples") === "on",
    inscricaoEstadual: field(formData, "inscricaoEstadual"),
    inscricaoMunicipal: field(formData, "inscricaoMunicipal"),
    cep,
    logradouro: field(formData, "logradouro"),
    numero: field(formData, "numero"),
    complemento: field(formData, "complemento"),
    bairro: field(formData, "bairro"),
    municipio: field(formData, "municipio"),
    uf,
    telefone: field(formData, "telefone"),
    email,
  };

  await updateEmpresa(session.empresa.id, input);
  await replaceCnaes(session.empresa.id, cnaes);

  revalidatePath("/empresa");
  return { ok: true };
}
