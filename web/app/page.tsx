import Link from "next/link";
import { Filters } from "@/components/filters";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import {
  fetchLicitacoes,
  fetchModalidadeOptions,
  fetchPortalOptions,
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
  if (filters.portal) params.set("portal", filters.portal);
  if (filters.modalidadeId !== undefined) {
    params.set("modalidade", String(filters.modalidadeId));
  }
  if (filters.status) params.set("status", filters.status);
  if (pagina && pagina > 1) params.set("pagina", String(pagina));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const resolvedSearchParams = await searchParams;
  const filters = parseFilters(resolvedSearchParams);

  const paginaParam = resolvedSearchParams.pagina;
  const paginaRaw = Array.isArray(paginaParam) ? paginaParam[0] : paginaParam;
  const pagina = Math.max(1, Math.trunc(Number(paginaRaw)) || 1);

  const [{ rows, total }, portalOptions, modalidadeOptions] =
    await Promise.all([
      fetchLicitacoes(filters, PAGE_SIZE, (pagina - 1) * PAGE_SIZE),
      fetchPortalOptions(),
      fetchModalidadeOptions(),
    ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasActiveFilters = Boolean(
    filters.q || filters.portal || filters.modalidadeId !== undefined || filters.status,
  );

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Licitações</h1>

      <Filters
        q={filters.q ?? ""}
        portal={filters.portal ?? ""}
        modalidadeId={
          filters.modalidadeId !== undefined ? String(filters.modalidadeId) : ""
        }
        status={filters.status ?? ""}
        portalOptions={portalOptions}
        modalidadeOptions={modalidadeOptions}
        hasActiveFilters={hasActiveFilters}
      />

      <p className="mb-2 text-sm text-gray-500">
        {total.toLocaleString("pt-BR")} licitações
      </p>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-gray-500">
          Nenhuma licitação encontrada.
        </p>
      ) : (
        <div className="border-t border-gray-200">
          {rows.map((row) => {
            const status = computeStatus(
              row.data_abertura_proposta,
              row.data_encerramento_proposta,
            );
            const localizacao = [row.municipio_nome, row.uf]
              .filter(Boolean)
              .join("/");

            return (
              <Link
                key={row.numero_controle_pncp}
                href={`/licitacao/${encodeURIComponent(row.numero_controle_pncp)}`}
                className="flex flex-col gap-2 border-b border-gray-200 py-3 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-gray-900">
                    {row.objeto_compra || "—"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {row.orgao_razao_social || "—"}
                    {localizacao ? ` · ${localizacao}` : ""}
                    {row.modalidade_nome ? ` · ${row.modalidade_nome}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <StatusBadge status={status} />
                  <span className="w-28 text-right text-sm text-gray-900 tabular-nums">
                    {formatCurrencyBRL(row.valor_total_estimado)}
                  </span>
                  <span className="w-24 text-right text-sm text-gray-500 tabular-nums">
                    {formatDateBR(row.data_encerramento_proposta)}
                  </span>
                </div>
              </Link>
            );
          })}
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
    <div className="mt-6 flex items-center justify-between text-sm text-gray-500">
      <Link
        href={`/${buildQueryString(filters, prev)}`}
        aria-disabled={isFirst}
        className={`rounded-lg border border-gray-200 bg-white px-3 py-1.5 ${
          isFirst ? "pointer-events-none opacity-50" : "hover:bg-gray-50"
        }`}
      >
        Anterior
      </Link>
      <span>
        Página {pagina} de {totalPages}
      </span>
      <Link
        href={`/${buildQueryString(filters, next)}`}
        aria-disabled={isLast}
        className={`rounded-lg border border-gray-200 bg-white px-3 py-1.5 ${
          isLast ? "pointer-events-none opacity-50" : "hover:bg-gray-50"
        }`}
      >
        Próxima
      </Link>
    </div>
  );
}
