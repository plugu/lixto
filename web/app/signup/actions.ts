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
import { lookupCNPJ, type CnpjLookup } from "@/lib/cnpj-lookup";
import { createEmpresaComAdmin } from "@/lib/signup-queries";
import { PORTES, UF_LIST, type Porte } from "@/lib/tenant-types";

export type SignupState = {
  erro: string | null;
};

/** Server-action wrapper around `lookupCNPJ` — the client form calls this
 * directly (no API route: `proxy.ts` blocks `/api/*` without a cookie). */
export async function lookupAction(cnpj: string): Promise<CnpjLookup | null> {
  if (!isValidCNPJ(cnpj)) return null;
  return lookupCNPJ(onlyDigits(cnpj));
}

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isPorte(value: string): value is Porte {
  return (PORTES as string[]).includes(value);
}

type CnaeForm = {
  codigo: string;
  descricao: string;
  principal: boolean;
};

function parseCnaes(formData: FormData): CnaeForm[] {
  const codigos = formData.getAll("cnae_codigo").map(String);
  const descricoes = formData.getAll("cnae_descricao").map(String);
  const principalIndex = formData.get("cnae_principal");
  const principalIdx =
    typeof principalIndex === "string" ? Number(principalIndex) : -1;

  return codigos
    .map((codigo, i) => ({
      codigo: codigo.trim(),
      descricao: (descricoes[i] ?? "").trim(),
      principal: i === principalIdx,
    }))
    .filter((c) => c.codigo && c.descricao);
}

export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const cnpj = str(formData, "cnpj");
  const razaoSocial = str(formData, "razaoSocial");
  const nomeFantasia = str(formData, "nomeFantasia");
  const naturezaJuridica = str(formData, "naturezaJuridica");
  const porteRaw = str(formData, "porte");
  const optanteSimples = formData.get("optanteSimples") === "on";
  const inscricaoEstadual = str(formData, "inscricaoEstadual");
  const inscricaoMunicipal = str(formData, "inscricaoMunicipal");
  const cep = str(formData, "cep");
  const logradouro = str(formData, "logradouro");
  const numero = str(formData, "numero");
  const complemento = str(formData, "complemento");
  const bairro = str(formData, "bairro");
  const municipio = str(formData, "municipio");
  const uf = str(formData, "uf");
  const empresaTelefone = str(formData, "empresaTelefone");
  const empresaEmail = str(formData, "empresaEmail");

  const nome = str(formData, "nome");
  const email = str(formData, "email");
  const senha = str(formData, "senha");
  const confirmarSenha = str(formData, "confirmarSenha");
  const cpf = str(formData, "cpf");
  const telefone = str(formData, "telefone");
  const cargo = str(formData, "cargo");

  const cnaes = parseCnaes(formData);

  if (!isValidCNPJ(cnpj)) return { erro: "CNPJ inválido." };
  if (!razaoSocial) return { erro: "Informe a razão social." };
  if (!isValidEmail(email)) return { erro: "E-mail inválido." };
  if (senha.length < 8) {
    return { erro: "A senha deve ter ao menos 8 caracteres." };
  }
  if (senha !== confirmarSenha) return { erro: "As senhas não coincidem." };
  if (cpf && !isValidCPF(cpf)) return { erro: "CPF inválido." };
  if (cep && !isValidCEP(cep)) return { erro: "CEP inválido." };
  if (cnaes.length === 0) {
    return { erro: "Adicione ao menos um CNAE." };
  }
  const principais = cnaes.filter((c) => c.principal);
  if (principais.length !== 1) {
    return { erro: "Selecione exatamente um CNAE principal." };
  }

  const porte = isPorte(porteRaw) ? porteRaw : null;
  const ufValue = UF_LIST.includes(uf) ? uf : null;

  const senhaHash = await hashPassword(senha);

  let result;
  try {
    result = await createEmpresaComAdmin({
      empresa: {
        cnpj,
        razaoSocial,
        nomeFantasia: nomeFantasia || null,
        naturezaJuridica: naturezaJuridica || null,
        porte,
        optanteSimples,
        inscricaoEstadual: inscricaoEstadual || null,
        inscricaoMunicipal: inscricaoMunicipal || null,
        cep: cep || null,
        logradouro: logradouro || null,
        numero: numero || null,
        complemento: complemento || null,
        bairro: bairro || null,
        municipio: municipio || null,
        uf: ufValue,
        telefone: empresaTelefone || null,
        email: empresaEmail || null,
      },
      cnaes,
      usuario: {
        nome,
        email,
        senhaHash,
        cpf: cpf || null,
        telefone: telefone || null,
        cargo: cargo || null,
      },
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return { erro: "CNPJ ou e-mail já cadastrado." };
    }
    throw err;
  }

  const token = await createSession(result.usuarioId);
  await setSessionCookie(token);
  redirect("/empresa");
}
