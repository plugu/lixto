"use server";

// Server action backing the /empresa/perfil matching profile form (ticket
// 65). Admin-only; empresaId always comes from the session, never from the
// form.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { UF_LIST } from "@/lib/tenant-types";
import {
  parseTermList,
  parseValor,
  upsertPerfil,
  type PerfilInput,
} from "@/lib/perfil-queries";

export type PerfilActionState = {
  ok?: boolean;
  erro?: string;
};

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function updatePerfilAction(
  _prev: PerfilActionState,
  formData: FormData,
): Promise<PerfilActionState> {
  const session = await requireAdmin();

  const produtos = parseTermList(field(formData, "produtos"));
  const palavrasChave = parseTermList(field(formData, "palavrasChave"));
  const exclusoes = parseTermList(field(formData, "exclusoes"));
  const ufs = formData.getAll("ufs").map((v) => String(v));

  for (const uf of ufs) {
    if (!UF_LIST.includes(uf.toUpperCase())) {
      return { erro: "UF inválida." };
    }
  }

  const valorMin = field(formData, "valorMin");
  const valorMax = field(formData, "valorMax");
  const observacoes = field(formData, "observacoes");

  const parsedMin = parseValor(valorMin);
  const parsedMax = parseValor(valorMax);
  if (parsedMin !== null && parsedMax !== null && Number(parsedMin) > Number(parsedMax)) {
    return { erro: "Valor mínimo maior que o máximo." };
  }

  const input: PerfilInput = {
    produtos,
    palavrasChave,
    exclusoes,
    ufs,
    valorMin,
    valorMax,
    observacoes,
  };

  await upsertPerfil(session.usuario.empresaId, input);

  revalidatePath("/empresa/perfil");
  return { ok: true };
}
