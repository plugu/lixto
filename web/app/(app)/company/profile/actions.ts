"use server";

// Server action backing the /company/profile match form. Admin-only;
// `companyId` always comes from the session, never from the form.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { UF_LIST } from "@/lib/types";
import { buildProfileEmbeddingText, embedText } from "@/lib/agent/embed";
import {
  parseMoney,
  parseTermList,
  upsertProfile,
  type ProfileInput,
} from "@/lib/profile-queries";

export type ProfileActionState = {
  ok?: boolean;
  error?: string;
  /** Saved, but a non-blocking part failed (currently: the embedding). */
  warning?: string;
};

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function updateProfileAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const session = await requireAdmin();

  const products = parseTermList(field(formData, "products"));
  const keywords = parseTermList(field(formData, "keywords"));
  const exclusions = parseTermList(field(formData, "exclusions"));
  const states = formData.getAll("states").map((v) => String(v));

  for (const state of states) {
    if (!UF_LIST.includes(state.toUpperCase())) {
      return { error: "UF inválida." };
    }
  }

  const minValue = field(formData, "minValue");
  const maxValue = field(formData, "maxValue");
  const notes = field(formData, "notes");

  const parsedMin = parseMoney(minValue);
  const parsedMax = parseMoney(maxValue);
  if (
    parsedMin !== null &&
    parsedMax !== null &&
    Number(parsedMin) > Number(parsedMax)
  ) {
    return { error: "Valor mínimo maior que o máximo." };
  }

  const input: ProfileInput = {
    products,
    keywords,
    exclusions,
    states,
    minValue,
    maxValue,
    notes,
  };

  // Best-effort: the embedding is the company side of the semantic match. If
  // the provider is down or unconfigured the profile still saves and the
  // previous vector (if any) is kept.
  const text = buildProfileEmbeddingText({ products, keywords, notes });
  const embedding = text ? await embedText(text) : null;

  await upsertProfile(
    session.user.companyId,
    input,
    embedding ? { ...embedding, text } : null,
  );

  revalidatePath("/company/profile");
  if (text && embedding === null) {
    return {
      ok: true,
      warning: "Dados salvos; similaridade semântica indisponível no momento.",
    };
  }
  return { ok: true };
}
