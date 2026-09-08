// pt-BR labels for the tender-analysis enums (migrations/006_tender_analysis.sql,
// src/lixto/analyze/schema.py). UI copy stays Portuguese — ADR 001, D7.

import type { BadgeTone } from "@/components/ui/badge";
import type {
  Confidence,
  DateKind,
  OverallRisk,
  RequirementCategory,
  RiskKind,
  Severity,
  StatementKind,
} from "@/lib/analysis-queries";

/** Suggested fact keys from `src/lixto/analyze/schema.py`
 * (`BASIC_FACT_KEYS` + `COMMERCIAL_FACT_KEYS`). Not exhaustive — a model may
 * emit a key we didn't anticipate; callers fall back to the row's own
 * `label` when a key is missing here. */
export const FACT_KEY_LABELS: Record<string, string> = {
  // basic
  procurement_method: "Modalidade",
  dispute_type: "Modo de disputa",
  judgment_criteria: "Critério de julgamento",
  estimated_value: "Valor estimado",
  contract_duration: "Vigência do contrato",
  execution_location: "Local de execução",
  participation_scope: "Âmbito de participação",
  // commercial
  delivery_deadline: "Prazo de entrega",
  delivery_location: "Local de entrega",
  payment_terms: "Condições de pagamento",
  payment_deadline: "Prazo de pagamento",
  price_adjustment: "Reajuste de preços",
  invoice_requirements: "Requisitos de nota fiscal",
};

/** Label for a fact row: the suggested key label when known, otherwise the
 * row's own `label` (every fact row always carries one). */
export function factLabel(key: string, ownLabel: string): string {
  return FACT_KEY_LABELS[key] ?? ownLabel;
}

export const DATE_KIND_LABELS: Record<DateKind, string> = {
  proposal_deadline: "Prazo para propostas",
  session: "Sessão pública",
  clarification_deadline: "Prazo para esclarecimentos",
  challenge_deadline: "Prazo para impugnação",
  site_visit: "Visita técnica",
  contract_start: "Início do contrato",
  delivery: "Entrega",
  other: "Outro",
};

export const REQUIREMENT_CATEGORY_LABELS: Record<
  RequirementCategory,
  string
> = {
  participation: "Participação",
  legal: "Habilitação jurídica",
  fiscal_labor: "Regularidade fiscal e trabalhista",
  economic_financial: "Qualificação econômico-financeira",
  technical: "Qualificação técnica",
  specification: "Especificação técnica",
  guarantee: "Garantias",
  other: "Outros",
};

// Order in which requirement categories are grouped in the "Participação e
// habilitação" section.
export const REQUIREMENT_CATEGORY_ORDER: RequirementCategory[] = [
  "participation",
  "legal",
  "fiscal_labor",
  "economic_financial",
  "technical",
  "specification",
  "guarantee",
  "other",
];

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export const RISK_KIND_LABELS: Record<RiskKind, string> = {
  risk: "Risco",
  red_flag: "Alerta",
  contradiction: "Contradição",
  amendment: "Alteração",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

export const STATEMENT_KIND_LABELS: Record<StatementKind, string> = {
  fact: "Fato",
  inference: "Inferência",
};

export const OVERALL_RISK_LABELS: Record<
  OverallRisk,
  { label: string; tone: BadgeTone }
> = {
  low: { label: "Risco baixo", tone: "ok" },
  medium: { label: "Risco médio", tone: "warn" },
  high: { label: "Risco alto", tone: "off" },
  critical: { label: "Risco crítico", tone: "off" },
};
