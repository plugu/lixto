import { FilterChips } from "@/components/filter-chips";
import { ColTD, ColTH, Filters } from "@/components/filters";
import { ProcurementCard } from "@/components/procurement-card";
import { StatusBadge } from "@/components/status-badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Search } from "@/components/ui/icons";
import { TBody, THead, TR, Table } from "@/components/ui/table";
import { embedQuery } from "@/lib/agent/embed";
import { getSession } from "@/lib/auth";
import { getCompanyCnaes } from "@/lib/company-queries";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import {
  fetchFacetCounts,
  fetchModalityOptions,
  fetchProcurements,
  parseFilters,
  type ProcurementFilters,
} from "@/lib/procurement-queries";
import { computeProcurementStatus } from "@/lib/status";

const PAGE_SIZE = 25;

function buildQueryString(filters: ProcurementFilters, page?: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  filters.portals?.forEach((portal) => params.append("portal", portal));
  filters.modalityIds?.forEach((id) => params.append("modality", String(id)));
  filters.statuses?.forEach((status) => params.append("status", status));
  if (filters.kind) params.set("kind", filters.kind);
  filters.categories?.forEach((category) => params.append("category", category));
  filters.states?.forEach((state) => params.append("state", state));
  if (filters.valueMin !== undefined) {
    params.set("valueMin", String(filters.valueMin));
  }
  if (filters.valueMax !== undefined) {
    params.set("valueMax", String(filters.valueMax));
  }
  if (filters.compat) params.set("compat", "1");
  if (page && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function ProcurementsPage({
  searchParams,
}: PageProps<"/procurements">) {
  const resolvedSearchParams = await searchParams;
  const filters = parseFilters(resolvedSearchParams);

  const pageParam = resolvedSearchParams.page;
  const pageRaw = Array.isArray(pageParam) ? pageParam[0] : pageParam;
  const page = Math.max(1, Math.trunc(Number(pageRaw)) || 1);

  // "Compatível com minha empresa": only logged-in visitors whose company has
  // at least one CNAE get the filter — everyone else has `compat` stripped so
  // the query, the toggle and the removable chip all agree it's absent
  // (`?compat=1` is a no-op when logged out).
  const session = await getSession();
  const companyCnaes = session
    ? (await getCompanyCnaes(session.user.companyId)).map((c) => c.cnae_code)
    : [];
  const showCompat = companyCnaes.length > 0;
  if (!showCompat) delete filters.compat;

  // Hybrid retrieval: embed the free-text query once (null on failure or no
  // `q`), reused by fetchProcurements below; facets stay keyword-only.
  const qEmbedding = filters.q ? await embedQuery(filters.q) : null;

  const [{ rows, total }, modalityOptions, facetCounts] = await Promise.all([
    fetchProcurements(
      filters,
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
      companyCnaes,
      qEmbedding,
    ),
    fetchModalityOptions(),
    fetchFacetCounts(filters),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-wide flex flex-col gap-5">
      <Filters
        filters={filters}
        facetCounts={facetCounts}
        total={total}
        showCompat={showCompat}
      />

      <FilterChips
        filters={filters}
        searchParams={resolvedSearchParams}
        modalityOptions={modalityOptions}
      />

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

      <Pagination page={page} totalPages={totalPages} filters={filters} />
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  filters,
}: {
  page: number;
  totalPages: number;
  filters: ProcurementFilters;
}) {
  if (totalPages <= 1) return null;

  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  return (
    <div className="flex items-center justify-end gap-3 text-[13px] text-ink-muted">
      <span className="tabular-nums">
        Página {page} de {totalPages.toLocaleString("pt-BR")}
      </span>
      <LinkButton
        href={`/procurements${buildQueryString(filters, prev)}`}
        variant="ghost"
        size="sm"
        aria-disabled={isFirst}
        className={isFirst ? "pointer-events-none opacity-40" : undefined}
      >
        Anterior
      </LinkButton>
      <LinkButton
        href={`/procurements${buildQueryString(filters, next)}`}
        variant="ghost"
        size="sm"
        aria-disabled={isLast}
        className={isLast ? "pointer-events-none opacity-40" : undefined}
      >
        Próxima
      </LinkButton>
    </div>
  );
}
