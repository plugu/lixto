// pt-BR labels for the case agent (PRODUCT, cycle 30) — same split as
// lib/analysis-labels.ts: UI copy stays Portuguese, identifiers stay English
// (ADR 001, D7).
//
// Relative imports (not "@/lib/...") on purpose, matching case-queries.ts /
// case-verdict.ts: this file is plain data, safe to import from a lib test
// without needing vitest's "@/" alias.

import type { CaseDecision, CaseOutcome, CaseStatus } from "./case-queries";
import type { CheckStatus, SessionSource } from "./case-verdict";
import { DOCUMENT_KINDS, type DocumentKind } from "./types";

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  waiting_analysis: "Aguardando análise",
  ready: "Pronto para decidir",
  decided: "Decidido",
};

export const DECISION_LABELS: Record<CaseDecision, string> = {
  submit: "Vou enviar",
  skip: "Não vou",
  missing_document: "Falta documento",
};

export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  met: "Atende",
  expiring: "Vence antes da sessão",
  missing: "Falta",
  manual: "Verificar",
};

/** Tone *values* only (not `BadgeTone` itself): keeps this module's imports
 * relative-only, per the header note above, while still being assignable
 * wherever a `BadgeTone` is expected (it's a subset of that union). */
export const CHECK_STATUS_TONES: Record<
  CheckStatus,
  "ok" | "warn" | "neutral"
> = {
  met: "ok",
  expiring: "warn",
  missing: "warn",
  manual: "neutral",
};

export const OUTCOME_LABELS: Record<CaseOutcome, string> = {
  won: "Ganhou",
  lost: "Perdeu",
  disqualified: "Desclassificado",
};

export const SESSION_SOURCE_LABELS: Record<SessionSource, string> = {
  dossier_session: "sessão pública no edital",
  dossier_proposal_deadline: "prazo final de propostas",
  procurement_closes_at: "encerramento no PNCP",
};

/** Label for a document kind, from `DOCUMENT_KINDS` (lib/types.ts). Falls
 * back to the raw kind for defensive purposes only — every kind
 * case-verdict.ts can emit is already in the list. */
export function documentKindLabel(kind: DocumentKind): string {
  return DOCUMENT_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}
