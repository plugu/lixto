import { FacetToolbarSource } from "@/components/procurements/facet-toolbar";
import { ColTD, ColTH, Pagination } from "@/components/filters";
import { ProcurementCard } from "@/components/procurement-card";
import { StatusBadge } from "@/components/status-badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Search } from "@/components/ui/icons";
import { TBody, THead, TR, Table } from "@/components/ui/table";
import { embedQuery } from "@/lib/agent/embed";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import {
  fetchFacetCounts,
  fetchProcurements,
  type ProcurementFilters,
} from "@/lib/procurement-queries";
import { computeProcurementStatus } from "@/lib/status";

export const PAGE_SIZE = 25;

/**
 * Everything on /procurements that needs the database or the embedder. The
 * page renders it inside <Suspense keyed on the filters + page>, so changing
 * a filter swaps this subtree for `ResultsSkeleton` while the toolbar, the
 * chips and the sidebar stay mounted.
 *
 * Facet counts run concurrently with the embed + row query: they do not
 * depend on the embedding, and they are memoised per filter set until the
 * next sync. `embedQuery` is memoised per process, so paging a search (the
 * Suspense key changes with the page) does not re-embed the same text. Rows
 * and the pagination total come back from one statement.
 */
export async function Results({
  filters,
  page,
  companyCnaes,
}: {
  filters: ProcurementFilters;
  page: number;
  companyCnaes: string[];
}) {
  const facetCountsPromise = fetchFacetCounts(filters);

  // Hybrid retrieval: embed the free-text query (null on failure or no `q`;
  // a repeated text is served from the per-process memo), reused by
  // fetchProcurements below; facets stay keyword-only.
  const qEmbedding = filters.q ? await embedQuery(filters.q) : null;

  const [{ rows, total }, facetCounts] = await Promise.all([
    fetchProcurements(
      filters,
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
      companyCnaes,
      qEmbedding,
    ),
    facetCountsPromise,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <FacetToolbarSource facetCounts={facetCounts} total={total} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Search size={20} />}
          title="Nenhuma licitação encontrada"
          hint="Tente remover algum filtro ou buscar por outra palavra-chave."
          action={
            <LinkButton href="/procurements" variant="secondary" size="sm">
              Limpar filtros
            </LinkButton>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-2.5 md:hidden">
            {rows.map((row) => (
              <ProcurementCard
                key={row.source_id}
                row={row}
                status={computeProcurementStatus(
                  row.proposal_opens_at,
                  row.proposal_closes_at,
                )}
              />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table density="default" className="min-w-[960px]">
              <THead rowLinks>
                <ColTH className="min-w-[24rem] max-w-[40rem]">Objeto</ColTH>
                <ColTH col="modality">Modalidade</ColTH>
                <ColTH col="status">Status</ColTH>
                <ColTH col="value" align="right">
                  Valor estimado
                </ColTH>
                <ColTH col="closing" align="right">
                  Encerramento
                </ColTH>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const status = computeProcurementStatus(
                    row.proposal_opens_at,
                    row.proposal_closes_at,
                  );
                  const location = [row.city_name, row.state]
                    .filter(Boolean)
                    .join("/");

                  return (
                    <TR
                      key={row.source_id}
                      href={`/procurement/${encodeURIComponent(row.source_id)}`}
                    >
                      <ColTD className="min-w-[24rem] max-w-[40rem] py-2">
                        <p className="line-clamp-2 text-sm font-medium text-ink">
                          {row.description || "—"}
                        </p>
                        <p className="flex items-center gap-1.5 truncate text-xs text-ink-muted">
                          <span className="truncate">
                            {row.agency_name || "—"}
                            {location ? ` · ${location}` : ""}
                          </span>
                          {row.match_kind === "semantic" && (
                            <span className="shrink-0 rounded bg-off-soft px-1.5 py-0.5 text-xs text-off">
                              Similar
                            </span>
                          )}
                        </p>
                      </ColTD>
                      <ColTD
                        col="modality"
                        className="whitespace-nowrap text-ink-muted"
                      >
                        {row.modality_name || "—"}
                      </ColTD>
                      <ColTD col="status" className="whitespace-nowrap">
                        <StatusBadge status={status} />
                      </ColTD>
                      <ColTD
                        col="value"
                        align="right"
                        numeric
                        className="whitespace-nowrap"
                      >
                        {formatCurrencyBRL(row.estimated_value)}
                      </ColTD>
                      <ColTD
                        col="closing"
                        align="right"
                        numeric
                        className="whitespace-nowrap text-ink-muted"
                      >
                        {formatDateBR(row.proposal_closes_at)}
                      </ColTD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </>
      )}

      <Pagination totalPages={totalPages} />
    </>
  );
}
