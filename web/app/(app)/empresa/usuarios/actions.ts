"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { isValidEmail } from "@/lib/br-validators";
import type { Role } from "@/lib/tenant-types";
import { createConvite, removeUsuario, updateRole } from "@/lib/usuario-queries";

export type CriarConviteState = {
  token?: string;
  erro?: string;
};

export async function criarConviteAction(
  _prev: CriarConviteState,
  formData: FormData,
): Promise<CriarConviteState> {
  const session = await requireAdmin();

  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (!nome) return { erro: "Informe o nome." };
  if (!isValidEmail(email)) return { erro: "E-mail inválido." };
  if (role !== "admin" && role !== "member") {
    return { erro: "Papel inválido." };
  }

  try {
    const { token } = await createConvite(session.empresa.id, {
      nome,
      email,
      role: role as Role,
    });
    revalidatePath("/empresa/usuarios");
    return { token };
  } catch (err) {
    return { erro: err instanceof Error ? err.message : "Erro ao gerar convite." };
  }
}

export async function updateRoleAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const usuarioId = Number(formData.get("usuarioId"));
  const role = String(formData.get("role") ?? "");

  if (!Number.isInteger(usuarioId)) return;
  if (role !== "admin" && role !== "member") return;
  // Caller cannot change their own row (guarded here; UI also disables it).
  if (usuarioId === session.usuario.id) return;

  await updateRole(session.empresa.id, usuarioId, role as Role);
  revalidatePath("/empresa/usuarios");
}

export async function removerUsuarioAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const usuarioId = Number(formData.get("usuarioId"));
  if (!Number.isInteger(usuarioId)) return;
  // Caller cannot remove their own row (guarded here; UI also disables it).
  if (usuarioId === session.usuario.id) return;

  await removeUsuario(session.empresa.id, usuarioId);
  revalidatePath("/empresa/usuarios");
}
