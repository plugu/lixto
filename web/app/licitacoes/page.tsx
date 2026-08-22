import Link from "next/link";
import { FilterChips } from "@/components/filter-chips";
import { Filters } from "@/components/filters";
import { FitBadge } from "@/components/fit-badge";
import { MultiSelect } from "@/components/multi-select";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import {
  fetchFacetCounts,
  fetchLicitacoes,
  fetchModalidadeOptions,
  parseFilters,
  type FitFilterValue,
  type LicitacaoFilters,
} from "@/lib/queries";
import { computeStatus } from "@/lib/status";

const PAGE_SIZE = 25;

type RawSearchParams = Record<string, string | string[] | undefined>;

// Static options (no facet counts this cycle, per ticket 15).
const FIT_OPTIONS = [
  { value: "fit", label: "Fit", count: 0 },
  { value: "borderline", label: "Borderline", count: 0 },
  { value: "no_fit", label: "No fit", count: 0 },
  { value: "sem_analise", label: "Sem análise", count: 0 },
];

const FIT_LABELS: Record<FitFilterValue, string> = {
  fit: "Fit",
  borderline: "Borderline",
  no_fit: "No fit",
  sem_analise: "Sem análise",
};

// The "Fit" filter is rendered as its own small GET form (rather than being
// folded into components/filters.tsx, out of this ticket's file scope):
// hidden inputs replicate every other active filter so applying/removing a
// fit value doesn't drop the rest of the current search.
function buildFitFormParams(searchParams: RawSearchParams): { name: string; value: string }[] {
  const inputs: { name: string; value: string }[] = [];
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "pagina" || key === "fit" || value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => inputs.push({ name: key, value: v }));
    } else {
      inputs.push({ name: key, value });
    }
  }
  return inputs;
}

function withoutFitValue(searchParams: RawSearchParams, value?: string): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(searchParams)) {
    if (key === "pagina" || raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (key === "fit" && (value === undefined || v === value)) continue;
      params.append(key, v);
    }
  }
  const qs = params.toString();
  return qs ? `/licitacoes?${qs}` : "/licitacoes";
}

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
    <div className="page-wide space-y-4">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Licitações
      </h1>

      <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-2">
          <Filters filters={filters} facetCounts={facetCounts} />
          <form
            method="GET"
            action="/licitacoes"
            className="rounded-lg border border-border bg-card p-3 shadow-subtle"
          >
            {buildFitFormParams(resolvedSearchParams).map((input, index) => (
              <input
                key={`${input.name}-${input.value}-${index}`}
                type="hidden"
                name={input.name}
                value={input.value}
              />
            ))}
            <MultiSelect
              name="fit"
              label="Fit"
              options={FIT_OPTIONS}
              selected={filters.fit ?? []}
            />
          </form>
        </div>
        <FilterChips
          filters={filters}
          searchParams={resolvedSearchParams}
          modalidadeOptions={modalidadeOptions}
        />
        {filters.fit && filters.fit.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {filters.fit.map((value) => (
              <Link
                key={value}
                href={withoutFitValue(resolvedSearchParams, value)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {FIT_LABELS[value]}
                <span aria-hidden="true">×</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {total.toLocaleString("pt-BR")} licitações
      </p>

      {rows.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <p className="text-muted-foreground">Nenhuma licitação encontrada.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-subtle">
          <table className="w-full min-w-[960px] text-base">
            <thead className="bg-muted/50 text-sm">
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
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Fit
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
                    <td className="min-w-[24rem] max-w-[40rem] px-4 py-3">
                      <Link
                        href={`/licitacao/${encodeURIComponent(row.numero_controle_pncp)}`}
                        className="line-clamp-2 font-medium text-foreground hover:underline"
                      >
                        {row.objeto_compra || "—"}
                      </Link>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {row.orgao_razao_social || "—"}
                        {localizacao ? ` · ${localizacao}` : ""}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {row.modalidade_nome || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <FitBadge
                        verdict={row.deep_verdict ?? row.fit_verdict}
                        score={row.fit_score}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-foreground tabular-nums">
                      {formatCurrencyBRL(row.valor_total_estimado)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground tabular-nums">
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
