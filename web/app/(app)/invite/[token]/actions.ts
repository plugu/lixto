"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import { isValidCPF, onlyDigits } from "@/lib/br-validators";
import { acceptInvite } from "@/lib/user-queries";

export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const cpfRaw = String(formData.get("cpf") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const jobTitle = String(formData.get("jobTitle") ?? "").trim();

  const fail = (message: string) => {
    const params = new URLSearchParams({ error: message });
    redirect(`/invite/${token}?${params.toString()}`);
  };

  if (!token) fail("Convite inválido ou expirado.");
  if (!name) fail("Informe o nome.");
  if (password.length < 8) fail("A senha deve ter ao menos 8 caracteres.");
  if (password !== confirmPassword) fail("As senhas não coincidem.");
  if (cpfRaw && !isValidCPF(cpfRaw)) fail("CPF inválido.");

  let userId: number;
  try {
    const passwordHash = await hashPassword(password);
    const result = await acceptInvite(token, {
      name,
      passwordHash,
      cpf: cpfRaw ? onlyDigits(cpfRaw) : null,
      phone: phone || null,
      jobTitle: jobTitle || null,
    });
    userId = result.userId;
  } catch (err) {
    fail(
      err instanceof Error ? err.message : "Não foi possível aceitar o convite.",
    );
    return;
  }

  const sessionToken = await createSession(userId);
  await setSessionCookie(sessionToken);
  redirect("/company");
}
