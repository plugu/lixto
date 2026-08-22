"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import { isValidCPF, onlyDigits } from "@/lib/br-validators";
import { acceptConvite } from "@/lib/usuario-queries";

export async function aceitarConviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const confirmarSenha = String(formData.get("confirmarSenha") ?? "");
  const cpfRaw = String(formData.get("cpf") ?? "").trim();
  const telefone = String(formData.get("telefone") ?? "").trim();
  const cargo = String(formData.get("cargo") ?? "").trim();

  const fail = (mensagem: string) => {
    const params = new URLSearchParams({ erro: mensagem });
    redirect(`/convite/${token}?${params.toString()}`);
  };

  if (!token) fail("Convite inválido ou expirado.");
  if (!nome) fail("Informe o nome.");
  if (senha.length < 8) fail("A senha deve ter ao menos 8 caracteres.");
  if (senha !== confirmarSenha) fail("As senhas não coincidem.");
  if (cpfRaw && !isValidCPF(cpfRaw)) fail("CPF inválido.");

  let usuarioId: number;
  try {
    const senhaHash = await hashPassword(senha);
    const result = await acceptConvite(token, {
      nome,
      senhaHash,
      cpf: cpfRaw ? onlyDigits(cpfRaw) : null,
      telefone: telefone || null,
      cargo: cargo || null,
    });
    usuarioId = result.usuarioId;
  } catch (err) {
    fail(err instanceof Error ? err.message : "Não foi possível aceitar o convite.");
    return;
  }

  const sessionToken = await createSession(usuarioId);
  await setSessionCookie(sessionToken);
  redirect("/empresa");
}
