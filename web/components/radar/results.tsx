import { Pagination } from "@/components/radar/filter-toolbar";
import { RadarCard } from "@/components/radar-card";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Radar as RadarIcon } from "@/components/ui/icons";
import { formatCurrencyBRL } from "@/lib/format";
import {
  fetchRadarList,
  fetchRadarSummary,
  type RadarFilters,
} from "@/lib/radar-list-queries";

export const PAGE_SIZE = 25;

/**
 * Everything on /radar that needs the database: the headline sentence (it
 * depends on `filters`, same as the cards) and the card grid + pagination.
 * The page renders it inside <Suspense keyed on the filters + page>, so
 * changing a filter swaps this subtree for `ResultsSkeleton` while the pill
 * tabs and the filter toolbar stay mounted.
 */
export async function Results({
  companyId,
  filters,
  page,
}: {
  companyId: number;
  filters: RadarFilters;
  page: number;
}) {
  const [rows, summary] = await Promise.all([
    fetchRadarList(companyId, filters, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    fetchRadarSummary(companyId, filters),
  ]);

  const totalPages = Math.max(1, Math.ceil(summary.total / PAGE_SIZE));

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] leading-[32px] text-ink">
          {formatCurrencyBRL(summary.total_value)} em compras públicas
          previstas para os próximos {filters.period ?? 365} dias que combinam
          com a sua empresa
        </h1>
        <p className="text-[13px] tabular-nums text-ink-muted">
          {summary.total.toLocaleString("pt-BR")} oportunidades
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<RadarIcon size={20} />}
          title="Nenhuma oportunidade futura encontrada"
          hint="Rode a sincronização de PCA e o radar, ou ajuste o perfil da empresa"
          action={
            <LinkButton href="/radar" variant="secondary" size="sm">
              Limpar filtros
            </LinkButton>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map((row) => (
            <RadarCard key={row.id} opportunity={row} />
          ))}
        </div>
      )}

      <Pagination totalPages={totalPages} />
    </>
  );
}
