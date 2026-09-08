"use server";

// Server actions backing the Salvar/Ignorar/Desfazer buttons on /radar/[id]
// (ticket 128). Shape of web/app/(app)/opportunities/actions.ts: called
// directly from a client component (not through a <form>), so they take a
// plain `id` rather than (prevState, formData). `companyId`/`userId` only
// ever come from the session, never from the caller.

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  clearRadarAction as clearRadarActionRow,
  setRadarAction,
} from "@/lib/radar-detail-queries";

export type RadarActionState = { ok: true } | { error: string };

function revalidateRadar(id: number) {
  revalidatePath("/radar");
  revalidatePath(`/radar/${id}`);
}

async function applyState(
  id: number,
  state: "saved" | "ignored",
): Promise<RadarActionState> {
  if (!Number.isInteger(id)) {
    return { error: "Oportunidade inválida." };
  }
  const session = await requireSession();
  await setRadarAction(session.user.companyId, id, session.user.id, state);
  revalidateRadar(id);
  return { ok: true };
}

export async function saveRadarAction(id: number): Promise<RadarActionState> {
  return applyState(id, "saved");
}

export async function ignoreRadarAction(id: number): Promise<RadarActionState> {
  return applyState(id, "ignored");
}

export async function clearRadarAction(id: number): Promise<RadarActionState> {
  if (!Number.isInteger(id)) {
    return { error: "Oportunidade inválida." };
  }
  const session = await requireSession();
  await clearRadarActionRow(session.user.companyId, id);
  revalidateRadar(id);
  return { ok: true };
}
