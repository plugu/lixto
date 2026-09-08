// The cited AI dossier for the procurement detail page — replaces the
// legacy shallow-enrichment panel. Server component only (no client JS):
// `CollapsibleCard` is built on native <details>/<summary>. Every fact,
// date, requirement, penalty and risk links back to its source document +
// page via `CitationLinks`. Sections are hidden entirely when their data is
// empty.

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { CollapsibleCard } from "@/components/ui/card";
import { Alert, Calendar } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  DATE_KIND_LABELS,
  factLabel,
  OVERALL_RISK_LABELS,
  REQUIREMENT_CATEGORY_LABELS,
  REQUIREMENT_CATEGORY_ORDER,
  RISK_KIND_LABELS,
  SEVERITY_LABELS,
} from "@/lib/analysis-labels";
import type {
  AnalysisDate,
  AnalysisFact,
  AnalysisRisk,
  Confidence,
  RequirementCategory,
  RiskKind,
  Severity,
  StatementKind,
  TenderAnalysis,
} from "@/lib/analysis-queries";
import { CitationLinks } from "@/components/citation-link";
import type { EnrichmentRow } from "@/lib/enrichment-queries";
import { formatDateBR } from "@/lib/format";
import type { DocumentRow } from "@/lib/procurement-detail-queries";

const URGENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  low: "neutral",
  medium: "warn",
  high: "off",
  critical: "off",
};

const RISK_KIND_TONE: Record<RiskKind, BadgeTone> = {
  risk: "warn",
  red_flag: "off",
  contradiction: "off",
  amendment: "neutral",
};

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function InferenceBadges({
  statementKind,
  confidence,
}: {
  statementKind: StatementKind;
  confidence: Confidence;
}) {
  return (
    <>
      {statementKind === "inference" && (
        <Badge tone="neutral">Inferência</Badge>
      )}
      {confidence === "low" && <Badge tone="warn">Verificar</Badge>}
    </>
  );
}

function FactDl({
  facts,
  documents,
}: {
  facts: AnalysisFact[];
  documents: DocumentRow[];
}) {
  if (facts.length === 0) return null;

  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">
            {factLabel(fact.key, fact.label)}
          </dt>
          <dd className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
            <span>{fact.value}</span>
            <InferenceBadges
              statementKind={fact.statement_kind}
              confidence={fact.confidence}
            />
            <CitationLinks citations={fact.citations} documents={documents} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function DatesTable({
  dates,
  documents,
}: {
  dates: AnalysisDate[];
  documents: DocumentRow[];
}) {
  if (dates.length === 0) return null;

  const now = new Date();

  return (
    <div className="min-w-0 -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
      <Table density="compact">
        <THead bg="surface">
          <TH>Prazo</TH>
          <TH>Quando</TH>
        </THead>
        <TBody>
          {dates.map((date) => {
            const when = date.occurs_at
              ? formatDateBR(date.occurs_at, true)
              : date.raw_text;
            const isUrgent =
              date.occurs_at !== null &&
              date.occurs_at.getTime() > now.getTime() &&
              date.occurs_at.getTime() - now.getTime() <= URGENT_WINDOW_MS;
            const n = date.occurs_at ? daysUntil(date.occurs_at, now) : 0;

            return (
              <TR key={date.sequence}>
                <TD>{DATE_KIND_LABELS[date.kind] ?? date.label}</TD>
                <TD>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>{when}</span>
                    {isUrgent && (
                      <Badge tone="warn">
                        <Alert size={12} /> Em {n} dia(s)
                      </Badge>
                    )}
                    <CitationLinks
                      citations={date.citations}
                      documents={documents}
                    />
                  </span>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

function RequirementsByCategory({
  analysis,
  documents,
}: {
  analysis: TenderAnalysis;
  documents: DocumentRow[];
}) {
  if (analysis.requirements.length === 0) return null;

  const byCategory = new Map<
    RequirementCategory,
    TenderAnalysis["requirements"]
  >();
  for (const requirement of analysis.requirements) {
    const list = byCategory.get(requirement.category) ?? [];
    list.push(requirement);
    byCategory.set(requirement.category, list);
  }

  return (
    <div className="flex flex-col gap-5">
      {REQUIREMENT_CATEGORY_ORDER.filter((category) =>
        byCategory.has(category),
      ).map((category) => (
        <div key={category} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
            {REQUIREMENT_CATEGORY_LABELS[category]}
          </h3>
          <ul className="flex flex-col gap-3">
            {(byCategory.get(category) ?? []).map((requirement) => (
              <li key={requirement.sequence} className="text-sm text-ink">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{requirement.title}</span>
                  <Badge tone={requirement.mandatory ? "accent" : "neutral"}>
                    {requirement.mandatory ? "Obrigatório" : "Opcional"}
                  </Badge>
                  <Badge tone={SEVERITY_TONE[requirement.severity]}>
                    {SEVERITY_LABELS[requirement.severity]}
                  </Badge>
                  <InferenceBadges
                    statementKind={requirement.statement_kind}
                    confidence={requirement.confidence}
                  />
                  <CitationLinks
                    citations={requirement.citations}
                    documents={documents}
                  />
                </div>
                <p className="text-ink-muted">{requirement.description}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RisksList({
  risks,
  documents,
}: {
  risks: AnalysisRisk[];
  documents: DocumentRow[];
}) {
  if (risks.length === 0) return null;

  const sorted = [...risks].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((risk) => (
        <li key={risk.sequence} className="text-sm text-ink">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={RISK_KIND_TONE[risk.kind]}>
              {RISK_KIND_LABELS[risk.kind]}
            </Badge>
            <Badge tone={SEVERITY_TONE[risk.severity]}>
              {SEVERITY_LABELS[risk.severity]}
            </Badge>
            <span className="font-medium">{risk.title}</span>
            <CitationLinks citations={risk.citations} documents={documents} />
          </div>
          <p className="text-ink-muted">{risk.description}</p>
          {risk.recommendation && (
            <p className="text-ink-muted">
              <span className="font-medium text-ink">Recomendação:</span>{" "}
              {risk.recommendation}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AnalysisPanel({
  analysis,
  documents,
  enrichment,
}: {
  analysis: TenderAnalysis;
  documents: DocumentRow[];
  enrichment: EnrichmentRow | null;
}) {
  const overallRisk = analysis.overall_risk
    ? OVERALL_RISK_LABELS[analysis.overall_risk]
    : null;

  const risks = analysis.risks.filter(
    (risk) => risk.kind === "risk" || risk.kind === "red_flag",
  );
  const contradictions = analysis.risks.filter(
    (risk) => risk.kind === "contradiction" || risk.kind === "amendment",
  );
  const basicFacts = analysis.facts.filter((fact) => fact.group === "basic");
  const commercialFacts = analysis.facts.filter(
    (fact) => fact.group === "commercial",
  );

  return (
    <CollapsibleCard
      eyebrow={`Análise com IA · v${analysis.version}`}
      className="border-t-2 border-t-accent"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-1.5">
        {overallRisk && (
          <Badge tone={overallRisk.tone}>{overallRisk.label}</Badge>
        )}
        {enrichment?.me_epp_exclusive && (
          <Badge tone="neutral">Exclusiva ME/EPP</Badge>
        )}
        {enrichment?.me_epp_preference && (
          <Badge tone="neutral">Preferência ME/EPP</Badge>
        )}
        {analysis.input_truncated && (
          <Badge tone="warn">Documentos parcialmente lidos</Badge>
        )}
        <span className="text-xs text-ink-muted">
          Analisado em {formatDateBR(analysis.analyzed_at, true)}
        </span>
      </div>

      {/* Resumo */}
      {(analysis.executive_summary || analysis.object_text) && (
        <div className="flex flex-col gap-3">
          {analysis.executive_summary && (
            <p className="whitespace-pre-wrap text-sm text-ink">
              {analysis.executive_summary}
            </p>
          )}
          {analysis.object_text && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
                Objeto
              </h3>
              <p className="whitespace-pre-wrap text-sm text-ink">
                {analysis.object_text}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Dados principais */}
      {basicFacts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
            Dados principais
          </h3>
          <FactDl facts={basicFacts} documents={documents} />
        </div>
      )}

      {/* Prazos */}
      {analysis.dates.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
            <Calendar size={14} /> Prazos
          </h3>
          <DatesTable dates={analysis.dates} documents={documents} />
        </div>
      )}

      {/* Participação e habilitação */}
      {analysis.requirements.length > 0 && (
        <CollapsibleCard title="Participação e habilitação" defaultOpen>
          <RequirementsByCategory analysis={analysis} documents={documents} />
        </CollapsibleCard>
      )}

      {/* Condições comerciais */}
      {commercialFacts.length > 0 && (
        <CollapsibleCard title="Condições comerciais" defaultOpen={false}>
          <FactDl facts={commercialFacts} documents={documents} />
        </CollapsibleCard>
      )}

      {/* Penalidades */}
      {analysis.penalties.length > 0 && (
        <CollapsibleCard title="Penalidades" defaultOpen={false}>
          <ul className="flex flex-col gap-2">
            {analysis.penalties.map((penalty) => (
              <li key={penalty.sequence} className="text-sm text-ink">
                <p>{penalty.description}</p>
                {penalty.basis && (
                  <p className="text-ink-muted">{penalty.basis}</p>
                )}
                <CitationLinks
                  citations={penalty.citations}
                  documents={documents}
                />
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      )}

      {/* Riscos e alertas */}
      {risks.length > 0 && (
        <CollapsibleCard title="Riscos e alertas" defaultOpen>
          <RisksList risks={risks} documents={documents} />
        </CollapsibleCard>
      )}

      {/* Contradições e alterações */}
      {contradictions.length > 0 && (
        <CollapsibleCard title="Contradições e alterações" defaultOpen={false}>
          <RisksList risks={contradictions} documents={documents} />
        </CollapsibleCard>
      )}

      {/* Informações não encontradas */}
      {analysis.missing.length > 0 && (
        <CollapsibleCard
          title="Informações não encontradas"
          defaultOpen={false}
        >
          <ul className="flex flex-col gap-1.5 text-sm text-ink">
            {analysis.missing.map((missing) => (
              <li key={missing.sequence}>
                <span className="font-medium">{missing.field}</span>
                {missing.note && (
                  <>
                    {" "}
                    — <span className="text-ink-muted">{missing.note}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      )}
    </CollapsibleCard>
  );
}
