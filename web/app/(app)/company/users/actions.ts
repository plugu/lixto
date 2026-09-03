"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { isValidEmail } from "@/lib/br-validators";
import { enqueue, type EnqueueInput } from "@/lib/email/outbox";
import type { Role } from "@/lib/types";
import { createInvite, removeUser, updateRole } from "@/lib/user-queries";

const APP_URL = process.env.LIXTO_APP_URL ?? "https://lixto.com.br";

/** `createInvite` (user-queries.ts) hardcodes `now() + interval '7 days'`
 * and does not return the expiry, nor does it come back from `getInvite`
 * (only id/name/email/companyLegalName) — both out of this ticket's file
 * scope. Mirrored here rather than re-queried. */
const INVITE_EXPIRY_DAYS = 7;

export type CreateInviteState = {
  token?: string;
  error?: string;
};

/** Payload for the invite mail — split out so it is testable without
 * invoking the full server action (which pulls in `@/lib/auth`'s
 * `requireAdmin`, a session/cookie dependency). `async` because this file is
 * `"use server"`: every top-level export must be a Server Action. */
export async function buildInviteEmailInput(input: {
  inviterName: string;
  companyName: string;
  email: string;
  token: string;
  companyId: number;
}): Promise<EnqueueInput> {
  const expiresAt = new Date(
    Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  return {
    toEmail: input.email,
    template: "invite",
    payload: {
      inviterName: input.inviterName,
      companyName: input.companyName,
      acceptUrl: `${APP_URL}/invite/${input.token}`,
      expiresAt,
    },
    companyId: input.companyId,
  };
}

export async function createInviteAction(
  _prev: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  const session = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (!name) return { error: "Informe o nome." };
  if (!isValidEmail(email)) return { error: "E-mail inválido." };
  if (role !== "admin" && role !== "member") {
    return { error: "Papel inválido." };
  }

  try {
    const { token } = await createInvite(session.company.id, {
      name,
      email,
      role: role as Role,
    });

    try {
      await enqueue(
        await buildInviteEmailInput({
          inviterName: session.user.name,
          companyName: session.company.tradeName ?? session.company.legalName,
          email,
          token,
          companyId: session.company.id,
        }),
      );
    } catch (err) {
      // A mail failure must never fail invite creation — the copy-link UI
      // still works even if the email doesn't arrive.
      console.error("[createInviteAction] failed to enqueue invite email", err);
    }

    revalidatePath("/company/users");
    return { token };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro ao gerar convite." };
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
