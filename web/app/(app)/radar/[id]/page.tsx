import { notFound } from "next/navigation";
import { RadarActions } from "@/components/radar-actions";
import { RadarAnalysis } from "@/components/radar-analysis";
import { RadarWhy } from "@/components/radar-why";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CollapsibleCard } from "@/components/ui/card";
import { requireSession } from "@/lib/auth";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import { getAnalysis } from "@/lib/radar-analysis-queries";
import { fetchRadarDetail, pncpPlanUrl } from "@/lib/radar-detail-queries";

// Tenant rule (docs/TENANT.md): the page is only reachable for opportunities
// the session company has a `future_opportunity_matches` row for —
// `fetchRadarDetail` returns null for anything else (wrong id, or another
// company's match) and both render the same notFound() here.

function scoreTone(score: number): BadgeTone {
  if (score >= 70) return "ok";
  if (score >= 40) return "warn";
  return "neutral";
}

const ACTION_LABELS: Record<"saved" | "ignored", string> = {
  saved: "Salva",
  ignored: "Ignorada",
};

function formatQuantity(quantity: string | null, unit: string | null): string {
  if (quantity === null) return "—";
  const num = Number(quantity);
  const formatted = Number.isFinite(num)
    ? num.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
    : quantity;
  return unit && unit !== "-" ? `${formatted} ${unit}` : formatted;
}

export default async function RadarDetailPage(
  props: PageProps<"/radar/[id]">,
) {
  const session = await requireSession();
  const { id: rawId } = await props.params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id)) notFound();

  const detail = await fetchRadarDetail(session.user.companyId, id);
  if (!detail) notFound();

  const analysisRow = await getAnalysis(session.user.companyId, id);

  const agencyUnit = [detail.agency_name, detail.unit_name]
    .filter(Boolean)
    .join(" · ");
  const location = [detail.city_name, detail.state].filter(Boolean).join("/");
  const metaLine = [agencyUnit, location].filter(Boolean).join(" · ");
  const classification = [
    detail.pdm_description,
    detail.catalog_classification_name,
    detail.superior_classification_name,
  ]
    .filter(Boolean)
    .join(" · ");
  const pncpUrl = pncpPlanUrl(detail.agency_tax_id, detail.year, detail.source_id);

  return (
    <div className="page-wide flex flex-col gap-6">
      <BackLink />

      <Card>
        <header className="flex flex-col gap-3">
          <h1 className="font-display text-2xl leading-snug text-ink">
            {detail.title}
          </h1>
          <p className="text-sm text-ink-muted">{metaLine || "—"}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={scoreTone(detail.opportunity_score)}>
              Probabilidade {detail.opportunity_score}
            </Badge>
            <Badge tone={scoreTone(detail.match_score)}>
              Aderência {detail.match_score}
            </Badge>
            {detail.action_state ? (
              <Badge tone={detail.action_state === "saved" ? "ok" : "neutral"}>
                {ACTION_LABELS[detail.action_state]}
              </Badge>
            ) : null}
          </div>

          <RadarActions id={detail.id} actionState={detail.action_state} />
        </header>
      </Card>

      <CollapsibleCard title="Resumo">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Fact
            label="Valor estimado"
            value={formatCurrencyBRL(detail.estimated_value)}
          />
          <Fact
            label="Quantidade"
            value={formatQuantity(detail.estimated_quantity, detail.supply_unit)}
          />
          <Fact
            label="Data prevista (compra prevista)"
            value={
              detail.expected_date
                ? `provável em ${formatDateBR(detail.expected_date)}`
                : "não informada"
            }
          />
          <Fact label="Ano do PCA" value={String(detail.plan_year)} />
          <Fact label="PDM / classificação" value={classification || "—"} />
          <Fact
            label="Unidade requisitante"
            value={detail.requesting_unit || "—"}
          />
        </dl>
      </CollapsibleCard>

      <CollapsibleCard title="Por que estamos mostrando isso?">
        <RadarWhy
          signals={detail.signals}
          reasons={detail.reasons}
          opportunityScore={detail.opportunity_score}
          matchScore={detail.match_score}
        />
      </CollapsibleCard>

      <CollapsibleCard title="Evidência — Plano Anual de Contratações">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Fact label="Nº controle (PCA)" value={detail.source_id} />
          <Fact
            label="Publicado em"
            value={formatDateBR(detail.published_at, true)}
          />
          <Fact
            label="Plano atualizado em"
            value={formatDateBR(detail.source_global_updated_at, true)}
          />
          <Fact
            label="Item atualizado em"
            value={
              detail.item_live
                ? formatDateBR(detail.source_updated_at, true)
                : "—"
            }
          />
        </dl>

        {!detail.item_live ? (
          <p className="text-[13px] text-warn">
            Item não está mais no PCA atual (esta oportunidade pode estar
            expirando).
          </p>
        ) : null}

        <div>
          <LinkButton
            href={pncpUrl}
            target="_blank"
            rel="noopener"
            variant="secondary"
            size="sm"
          >
            Ver no PNCP
          </LinkButton>
        </div>
      </CollapsibleCard>

      <Card>
        <h2 className="font-display text-[17px] leading-6 text-ink">
          Análise com IA
        </h2>
        <div className="pt-3">
          <RadarAnalysis
            id={detail.id}
            initial={
              analysisRow
                ? {
                    analysis: analysisRow.content,
                    model: analysisRow.model,
                    created_at: analysisRow.created_at,
                  }
                : null
            }
          />
        </div>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <LinkButton href="/radar" variant="ghost" size="sm" className="self-start">
      ← Radar
    </LinkButton>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="break-words text-sm font-medium tabular-nums text-ink">
        {value}
      </dd>
    </div>
  );
}
