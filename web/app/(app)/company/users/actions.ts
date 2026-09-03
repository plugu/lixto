"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { isValidEmail } from "@/lib/br-validators";
import { enqueue, type EnqueueInput } from "@/lib/email/outbox";
import type { Role } from "@/lib/types";
import { createInvite, removeUser, updateRole } from "@/lib/user-queries";

const APP_URL = process.env.LIXTO_APP_URL ?? "https://lixto.com.br";

export type CreateInviteState = {
  token?: string;
  error?: string;
};

/** Payload for the invite mail — split out so it is testable without
 * invoking the full server action (which pulls in `@/lib/auth`'s
 * `requireAdmin`, a session/cookie dependency). `async` because this file is
 * `"use server"`: every top-level export must be a Server Action.
 *
 * `expiresAt` is the real `invite_expires_at` persisted by `createInvite`
 * (via its `onCommitted` hook), not re-derived here. */
export async function buildInviteEmailInput(input: {
  inviterName: string;
  companyName: string;
  email: string;
  token: string;
  companyId: number;
  expiresAt: Date;
}): Promise<EnqueueInput> {
  return {
    toEmail: input.email,
    template: "invite",
    payload: {
      inviterName: input.inviterName,
      companyName: input.companyName,
      acceptUrl: `${APP_URL}/invite/${input.token}`,
      expiresAt: input.expiresAt.toISOString(),
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
    // Enqueued inside the transaction, before COMMIT (ADR 002 D1): a
    // rejecting enqueue rolls the invite back instead of leaving a pending
    // user with no invite mail — the admin simply retries.
    const { token } = await createInvite(
      session.company.id,
      { name, email, role: role as Role },
      async ({ client, token: rawToken, expiresAt }) => {
        await enqueue(
          await buildInviteEmailInput({
            inviterName: session.user.name,
            companyName:
              session.company.tradeName ?? session.company.legalName,
            email,
            token: rawToken,
            companyId: session.company.id,
            expiresAt,
          }),
          client,
        );
      },
    );

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
