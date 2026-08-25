"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { isValidEmail } from "@/lib/br-validators";
import type { Role } from "@/lib/types";
import { createInvite, removeUser, updateRole } from "@/lib/user-queries";

export type CreateInviteState = {
  token?: string;
  erro?: string;
};

export async function createInviteAction(
  _prev: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  const session = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (!name) return { erro: "Informe o nome." };
  if (!isValidEmail(email)) return { erro: "E-mail inválido." };
  if (role !== "admin" && role !== "member") {
    return { erro: "Papel inválido." };
  }

  try {
    const { token } = await createInvite(session.company.id, {
      name,
      email,
      role: role as Role,
    });
    revalidatePath("/company/users");
    return { token };
  } catch (err) {
    return { erro: err instanceof Error ? err.message : "Erro ao gerar convite." };
  }
}

export async function updateRoleAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const userId = Number(formData.get("userId"));
  const role = String(formData.get("role") ?? "");

  if (!Number.isInteger(userId)) return;
  if (role !== "admin" && role !== "member") return;
  // Caller cannot change their own row (guarded here; UI also disables it).
  if (userId === session.user.id) return;

  await updateRole(session.company.id, userId, role as Role);
  revalidatePath("/company/users");
}

export async function removeUserAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(userId)) return;
  // Caller cannot remove their own row (guarded here; UI also disables it).
  if (userId === session.user.id) return;

  await removeUser(session.company.id, userId);
  revalidatePath("/company/users");
}
