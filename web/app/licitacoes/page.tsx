import { FilterChips } from "@/components/filter-chips";
import { ColTD, ColTH, Filters } from "@/components/filters";
import { FitBadge } from "@/components/fit-badge";
import { StatusBadge } from "@/components/status-badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Search } from "@/components/ui/icons";
import { TBody, THead, TR, Table, TH } from "@/components/ui/table";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import {
  fetchFacetCounts,
  fetchLicitacoes,
  fetchModalidadeOptions,
  parseFilters,
  type LicitacaoFilters,
} from "@/lib/queries";
import { computeStatus } from "@/lib/status";

const PAGE_SIZE = 25;

function buildQueryString(
  filters: LicitacaoFilters,
  pagina?: number,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  filters.portais?.forEach((portal) => params.append("portal", portal));
  filters.modalidadeIds?.forEach((id) => params.append("modalidade", String(id)));
  filters.statuses?.forEach((status) => params.append("status", status));
  if (filters.categoria) params.set("categoria", filters.categoria);
  filters.setores?.forEach((setor) => params.append("setor", setor));
  filters.ufs?.forEach((uf) => params.append("uf", uf));
  if (filters.valorMin !== undefined) {
    params.set("valorMin", String(filters.valorMin));
  }
  if (filters.valorMax !== undefined) {
    params.set("valorMax", String(filters.valorMax));
  }
  filters.fit?.forEach((v) => params.append("fit", v));
  if (pagina && pagina > 1) params.set("pagina", String(pagina));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function Home({ searchParams }: PageProps<"/licitacoes">) {
  const resolvedSearchParams = await searchParams;
  const filters = parseFilters(resolvedSearchParams);

  const paginaParam = resolvedSearchParams.pagina;
  const paginaRaw = Array.isArray(paginaParam) ? paginaParam[0] : paginaParam;
  const pagina = Math.max(1, Math.trunc(Number(paginaRaw)) || 1);

  const [{ rows, total }, modalidadeOptions, facetCounts] = await Promise.all([
    fetchLicitacoes(filters, PAGE_SIZE, (pagina - 1) * PAGE_SIZE),
    fetchModalidadeOptions(),
    fetchFacetCounts(filters),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-wide flex flex-col gap-5">
      <Filters filters={filters} facetCounts={facetCounts} total={total} />

      <FilterChips
        filters={filters}
        searchParams={resolvedSearchParams}
        modalidadeOptions={modalidadeOptions}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Search size={20} />}
          title="Nenhuma licitação encontrada"
          hint="Tente remover algum filtro ou buscar por outra palavra-chave."
          action={
            <LinkButton href="/licitacoes" variant="secondary" size="sm">
              Limpar filtros
            </LinkButton>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <Table density="default" className="min-w-[960px]">
            <THead>
              {/* Matches the zero-width cell `TR href` prepends for the
                  whole-row link, keeping header and body columns aligned. */}
              <TH aria-hidden="true" style={{ width: 0, padding: 0 }} />
              <ColTH className="min-w-[24rem] max-w-[40rem]">Objeto</ColTH>
              <ColTH col="modalidade">Modalidade</ColTH>
              <ColTH col="status">Status</ColTH>
              <ColTH col="fit">Fit</ColTH>
              <ColTH col="valor" align="right">
                Valor estimado
              </ColTH>
              <ColTH col="encerramento" align="right">
                Encerramento
              </ColTH>
            </THead>
            <TBody>
              {rows.map((row) => {
                const status = computeStatus(
                  row.data_abertura_proposta,
                  row.data_encerramento_proposta,
                );
                const localizacao = [row.municipio_nome, row.uf]
                  .filter(Boolean)
                  .join("/");

                return (
                  <TR
                    key={row.numero_controle_pncp}
                    href={`/licitacao/${encodeURIComponent(row.numero_controle_pncp)}`}
                  >
                    <ColTD className="min-w-[24rem] max-w-[40rem] py-2">
                      <p className="line-clamp-2 text-sm font-medium text-ink">
                        {row.objeto_compra || "—"}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {row.orgao_razao_social || "—"}
                        {localizacao ? ` · ${localizacao}` : ""}
                      </p>
                    </ColTD>
                    <ColTD col="modalidade" className="whitespace-nowrap text-ink-muted">
                      {row.modalidade_nome || "—"}
                    </ColTD>
                    <ColTD col="status" className="whitespace-nowrap">
                      <StatusBadge status={status} />
                    </ColTD>
                    <ColTD col="fit" className="whitespace-nowrap">
                      <FitBadge
                        verdict={row.deep_verdict ?? row.fit_verdict}
                        score={row.fit_score}
                      />
                    </ColTD>
                    <ColTD
                      col="valor"
                      align="right"
                      numeric
                      className="whitespace-nowrap"
                    >
                      {formatCurrencyBRL(row.valor_total_estimado)}
                    </ColTD>
                    <ColTD
                      col="encerramento"
                      align="right"
                      numeric
                      className="whitespace-nowrap text-ink-muted"
                    >
                      {formatDateBR(row.data_encerramento_proposta)}
                    </ColTD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      <Pagination pagina={pagina} totalPages={totalPages} filters={filters} />
    </div>
  );
}

function Pagination({
  pagina,
  totalPages,
  filters,
}: {
  pagina: number;
  totalPages: number;
  filters: LicitacaoFilters;
}) {
  if (totalPages <= 1) return null;

  const prev = Math.max(1, pagina - 1);
  const next = Math.min(totalPages, pagina + 1);
  const isFirst = pagina <= 1;
  const isLast = pagina >= totalPages;

  return (
    <div className="flex items-center justify-end gap-3 text-[13px] text-ink-muted">
      <span className="tabular-nums">
        Página {pagina} de {totalPages.toLocaleString("pt-BR")}
      </span>
      <LinkButton
        href={`/licitacoes${buildQueryString(filters, prev)}`}
        variant="ghost"
        size="sm"
        aria-disabled={isFirst}
        className={isFirst ? "pointer-events-none opacity-40" : undefined}
      >
        Anterior
      </LinkButton>
      <LinkButton
        href={`/licitacoes${buildQueryString(filters, next)}`}
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
