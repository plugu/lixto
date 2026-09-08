// pt-BR label maps for the Radar's signal/reason codes. Moved out of
// web/components/radar-card.tsx (ticket 127) so the detail page's "why"
// tables (ticket 128, web/components/radar-why.tsx) can share them without
// duplicating the maps.

import type { ReasonCode } from "./match-engine";
import type { SignalCode } from "./radar-engine";

export const SIGNAL_LABELS: Record<SignalCode, string> = {
  pca_item: "No PCA do órgão",
  date_near: "data próxima",
  date_mid: "data em médio prazo",
  date_far: "data distante",
  recent_plan_update: "plano atualizado",
};

/** Only the ReasonCodes the Radar's `scoreCompanyMatch` actually emits
 * (radar-engine.ts) — the reactive match engine's CNAE/enrichment/ME-EPP
 * codes never appear here. */
export type RadarReasonCode =
  | "term_text"
  | "semantic_high"
  | "semantic"
  | "state_ok"
  | "state_out"
  | "value_ok"
  | "value_out"
  | "value_unknown"
  | "exclusion"
  | "no_profile";

export const REASON_LABELS: Record<RadarReasonCode, string> = {
  term_text: "termos do perfil",
  semantic_high: "muito similar ao cadastro",
  semantic: "afinidade semântica",
  state_ok: "UF compatível",
  state_out: "fora da UF",
  value_ok: "valor compatível",
  value_out: "fora da faixa de valor",
  value_unknown: "valor desconhecido",
  exclusion: "termo de exclusão",
  no_profile: "sem cadastro de match",
};

/** Best-effort label lookup for a signal or reason code — falls back to the
 * raw code so an unmapped value still renders something instead of throwing. */
export function chipLabel(code: SignalCode | ReasonCode): string {
  return (
    SIGNAL_LABELS[code as SignalCode] ??
    REASON_LABELS[code as RadarReasonCode] ??
    code
  );
}
