// Enrichment panel for the procurement detail page (replaces the legacy
// analysis panel). Renders the canonical, company-agnostic enrichment:
// resumo, categorias, requisitos por tipo, riscos, entrega, ME/EPP e
// complexidade. Hidden entirely when the procurement has no enrichment.
// Rendered as an accented card (top border) so it reads distinct from the
// plain white cards beside it.

import { Badge } from "@/components/ui/badge";
import { CollapsibleCard } from "@/components/ui/card";
import { Alert } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  COMPLEXITY_LABELS,
  REQUIREMENT_KIND_LABELS,
  type EnrichmentRow,
} from "@/lib/enrichment-queries";

export function EnrichmentPanel({
  enrichment,
}: {
  enrichment: EnrichmentRow | null;
}) {
  if (!enrichment) return null;

  const hasCategories = enrichment.categories.length > 0;
  const hasRequirements = enrichment.requirements.length > 0;
  const hasRisks = enrichment.risks.length > 0;
  const delivery = [
    enrichment.delivery_location,
    enrichment.delivery_deadline_days !== null
      ? `${enrichment.delivery_deadline_days} dias`
      : null,
  ].filter(Boolean);
  const flags = [
    enrichment.me_epp_exclusive ? "Exclusiva ME/EPP" : null,
    enrichment.me_epp_preference ? "Preferência ME/EPP" : null,
    enrichment.requires_certification ? "Exige certificação" : null,
    enrichment.requires_technical_certificate ? "Exige atestado técnico" : null,
  ].filter((flag): flag is string => flag !== null);

  return (
    <CollapsibleCard eyebrow="Análise" className="border-t-2 border-t-accent">
      {enrichment.summary && (
        <p className="whitespace-pre-wrap text-sm text-ink">
          {enrichment.summary}
        </p>
      )}

      {hasCategories && (
        <div className="flex flex-wrap gap-1.5">
          {enrichment.categories.map((category) => (
            <Badge key={category} tone="accent">
              {category}
            </Badge>
          ))}
        </div>
      )}

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((flag) => (
            <Badge key={flag} tone="neutral">
              {flag}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-5">
        {hasRequirements && (
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
              Requisitos
            </h3>
            <div className="min-w-0 -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
              <Table density="compact">
                <THead bg="surface">
                  <TH>Tipo</TH>
                  <TH>Descrição</TH>
                </THead>
                <TBody>
                  {enrichment.requirements.map((requirement, index) => (
                    <TR key={index}>
                      <TD>
                        {REQUIREMENT_KIND_LABELS[requirement.kind] ??
                          requirement.kind}
                      </TD>
                      <TD>{requirement.description}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </div>
        )}

        {hasRisks && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
              Riscos
            </h3>
            <ul className="flex flex-col gap-1.5 text-sm text-ink">
              {enrichment.risks.map((risk, index) => (
                <li key={index} className="flex items-start gap-2">
                  <Alert size={16} className="mt-0.5 shrink-0 text-warn" />
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {delivery.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
              Entrega
            </h3>
            <p className="text-sm text-ink">{delivery.join(" · ")}</p>
          </div>
        )}

        {enrichment.complexity && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
              Complexidade
            </h3>
            <p className="text-sm text-ink">
              {COMPLEXITY_LABELS[enrichment.complexity] ?? enrichment.complexity}
            </p>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
