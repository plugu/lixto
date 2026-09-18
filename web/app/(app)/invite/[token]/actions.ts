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
  let approvalStatus: string;
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
    approvalStatus = result.approvalStatus;
  } catch (err) {
    fail(
      err instanceof Error ? err.message : "Não foi possível aceitar o convite.",
    );
    return;
  }

  // F4: an invite only opens a session for an already-approved company
  // (ADR 003 §D1 — invitees inherit the company's status). Pending/rejected
  // land on /login with the same status the login page already renders
  // copy for, instead of getting a working session mid-review.
  if (approvalStatus !== "approved") {
    redirect(`/login?error=${approvalStatus}`);
  }

  const sessionToken = await createSession(userId);
  await setSessionCookie(sessionToken);
  redirect("/company");
}
