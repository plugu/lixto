import { notFound } from "next/navigation";
import { after } from "next/server";
import { AnalysisPanel } from "@/components/analysis-panel";
import { AnalyzeButton } from "@/components/analyze-button";
import { DocumentsList } from "@/components/documents-list";
import { ItemsTable } from "@/components/items-table";
import { StatusBadge } from "@/components/status-badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CollapsibleCard } from "@/components/ui/card";
import { fetchAnalysis, getAnalysisState } from "@/lib/analysis-queries";
import { requireSession } from "@/lib/auth";
import { fetchEnrichment } from "@/lib/enrichment-queries";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import { enqueueMissingResults, fetchPriceBenchmark } from "@/lib/price-queries";
import {
  fetchDocuments,
  fetchItems,
  fetchProcurementDetail,
  type ProcurementDetail,
} from "@/lib/procurement-detail-queries";
import { computeProcurementStatus } from "@/lib/status";

// The route segment carries source_id (numeroControlePNCP), which contains a
// literal "/" (e.g. "11285282000137-1-000033/2026"). List links encode it with
// encodeURIComponent, so the segment arrives as "...%2F2026". Depending on how
// Next normalizes the path, `sourceId` may still contain the literal "%2F" or
// may have already been decoded to "/" — handle both.
function decodeSourceId(raw: string): string {
  return /%2F/i.test(raw) ? decodeURIComponent(raw) : raw;
}

function buildPncpUrl(detail: ProcurementDetail): string | null {
  if (!detail.agency_tax_id || !detail.year || !detail.sequence) return null;
  return `https://pncp.gov.br/app/editais/${detail.agency_tax_id}/${detail.year}/${detail.sequence}`;
}

export default async function ProcurementDetailPage(
  props: PageProps<"/procurement/[sourceId]">,
) {
  const session = await requireSession();

  const { sourceId } = await props.params;
  const detail = await fetchProcurementDetail(decodeSourceId(sourceId));

  if (!detail) notFound();

  const [items, documents, enrichment, prices, analysisState, analysis] =
    await Promise.all([
      fetchItems(detail.id),
      fetchDocuments(detail.id),
      fetchEnrichment(detail.id),
      fetchPriceBenchmark(detail.id),
      getAnalysisState(detail.id, session.user.companyId),
      fetchAnalysis(detail.id),
    ]);

  // Lazy-fill queueing is a write, not read-path data: it must never delay
  // first byte. Runs after the response is sent; a queue failure here must not
  // break the page.
  after(() => enqueueMissingResults(detail.id).catch(() => {}));

  const status = computeProcurementStatus(
    detail.proposal_opens_at,
    detail.proposal_closes_at,
  );
  const location = [detail.city_name, detail.state].filter(Boolean).join("/");
  const agencyUnit = [detail.agency_name, detail.unit_name]
    .filter(Boolean)
    .join(" · ");
  const metaLine = [agencyUnit, location, detail.modality_name]
    .filter(Boolean)
    .join(" · ");
  const pncpUrl = buildPncpUrl(detail);

  const showAnalyzeButton =
    status !== "closed" &&
    (analysisState.analysis === null ||
      analysisState.stale ||
      analysisState.job !== null);

  return (
    <div className="page-wide flex flex-col gap-6">
      <BackLink />

      <Card>
        <header className="flex flex-col gap-3">
          <h1 className="font-display text-2xl leading-snug text-ink">
            {detail.description || "—"}
          </h1>
          <p className="text-sm text-ink-muted">{metaLine || "—"}</p>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
          </div>

          {showAnalyzeButton && (
            <AnalyzeButton
              procurementId={detail.id}
              initial={{
                hasAnalysis: analysisState.analysis !== null,
                stale: analysisState.stale,
                job: analysisState.job
                  ? {
                      status: analysisState.job.status,
                      error: analysisState.job.error,
                    }
                  : null,
              }}
            />
          )}

          <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Fact
              label="Valor estimado"
              value={formatCurrencyBRL(detail.estimated_value)}
            />
            <Fact
              label="Abertura"
              value={formatDateBR(detail.proposal_opens_at, true)}
            />
            <Fact
              label="Encerramento"
              value={formatDateBR(detail.proposal_closes_at, true)}
            />
            <Fact label="Nº controle" value={detail.source_id} />
          </dl>

          {(detail.origin_url || pncpUrl) && (
            <div className="flex flex-wrap gap-4 pt-1">
              {detail.origin_url && (
                <a
                  href={detail.origin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent hover:underline"
                >
                  Abrir no sistema de origem
                </a>
              )}
              {pncpUrl && (
                <a
                  href={pncpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent hover:underline"
                >
                  Ver no PNCP
                </a>
              )}
            </div>
          )}
        </header>
      </Card>

      {(() => {
        // The dossier is the page's content: it renders full width above
        // "Itens", never in the sidebar. The 22rem sidebar only exists to
        // point at the shallow enrichment while there is no dossier yet.
        const showSidebar = analysis === null && enrichment !== null;

        return (
          <div
            className={
              showSidebar
                ? "grid min-w-0 gap-6 lg:grid-cols-[1fr_22rem]"
                : "grid min-w-0 gap-6"
            }
          >
            <div className="flex min-w-0 flex-col gap-6">
              {analysis && (
                <AnalysisPanel
                  analysis={analysis}
                  documents={documents}
                  enrichment={enrichment}
                />
              )}

              <CollapsibleCard title="Itens">
                <ItemsTable items={items} prices={prices} />
              </CollapsibleCard>

              <CollapsibleCard title="Documentos">
                <DocumentsList documents={documents} />
              </CollapsibleCard>
            </div>

            {showSidebar && (
              <div className="min-w-0 lg:sticky lg:top-8 lg:self-start">
                <Card>
                  <p className="text-sm text-ink">
                    Análise resumida disponível — clique em Analisar com IA
                    para o dossiê completo
                  </p>
                </Card>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function BackLink() {
  return (
    <LinkButton
      href="/procurements"
      variant="ghost"
      size="sm"
      className="self-start"
    >
      ← Licitações
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
