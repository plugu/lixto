import Link from "next/link";
import { Filters } from "@/components/filters";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import {
  fetchLicitacoes,
  fetchModalidadeOptions,
  fetchSetorOptions,
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

  const [{ rows, total }, portalOptions, modalidadeOptions, setorOptions] =
    await Promise.all([
      fetchLicitacoes(filters, PAGE_SIZE, (pagina - 1) * PAGE_SIZE),
      fetchPortalOptions(),
      fetchModalidadeOptions(),
      fetchSetorOptions(),
    ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasActiveFilters = Boolean(
    filters.q ||
      (filters.portais && filters.portais.length > 0) ||
      (filters.modalidadeIds && filters.modalidadeIds.length > 0) ||
      (filters.statuses && filters.statuses.length > 0) ||
      filters.categoria ||
      (filters.setores && filters.setores.length > 0) ||
      (filters.ufs && filters.ufs.length > 0) ||
      filters.valorMin !== undefined ||
      filters.valorMax !== undefined,
  );

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Licitações
      </h1>

      <Filters
        q={filters.q ?? ""}
        portal={filters.portais?.[0] ?? ""}
        modalidadeId={
          filters.modalidadeIds?.[0] !== undefined
            ? String(filters.modalidadeIds[0])
            : ""
        }
        status={filters.statuses?.[0] ?? ""}
        categoria={filters.categoria ?? ""}
        setor={filters.setores?.[0] ?? ""}
        setorOptions={setorOptions}
        portalOptions={portalOptions}
        modalidadeOptions={modalidadeOptions}
        hasActiveFilters={hasActiveFilters}
      />

      <p className="text-sm text-muted-foreground">
        {total.toLocaleString("pt-BR")} licitações
      </p>

      {rows.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <p className="text-muted-foreground">Nenhuma licitação encontrada.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-subtle">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Objeto
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Modalidade
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Valor estimado
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Encerramento
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const status = computeStatus(
                  row.data_abertura_proposta,
                  row.data_encerramento_proposta,
                );
                const localizacao = [row.municipio_nome, row.uf]
                  .filter(Boolean)
                  .join("/");

                return (
                  <tr
                    key={row.numero_controle_pncp}
                    className="transition-colors hover:bg-muted/30"
                  >
                    <td className="max-w-md px-4 py-3">
                      <Link
                        href={`/licitacao/${encodeURIComponent(row.numero_controle_pncp)}`}
                        className="line-clamp-2 font-medium text-foreground hover:underline"
                      >
                        {row.objeto_compra || "—"}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.orgao_razao_social || "—"}
                        {localizacao ? ` · ${localizacao}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.modalidade_nome || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">
                      {formatCurrencyBRL(row.valor_total_estimado)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                      {formatDateBR(row.data_encerramento_proposta)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

  const buttonClass =
    "rounded-lg border border-border bg-card px-3 py-1.5 shadow-subtle transition-colors";

  return (
    <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
      <Link
        href={`/licitacoes${buildQueryString(filters, prev)}`}
        aria-disabled={isFirst}
        className={`${buttonClass} ${
          isFirst ? "pointer-events-none opacity-50" : "hover:bg-muted"
        }`}
      >
        Anterior
      </Link>
      <span>
        Página {pagina} de {totalPages}
      </span>
      <Link
        href={`/licitacoes${buildQueryString(filters, next)}`}
        aria-disabled={isLast}
        className={`${buttonClass} ${
          isLast ? "pointer-events-none opacity-50" : "hover:bg-muted"
        }`}
      >
        Próxima
      </Link>
    </div>
  );
}
