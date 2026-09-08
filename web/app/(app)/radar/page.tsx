// Radar list page (ticket 127): the session company's matched, still-
// `predicted` future opportunities, ranked by match score, with view/state/
// period/value/score filters. Modelled on
// web/app/(app)/procurements/page.tsx (PageProps, requireSession, PAGE_SIZE,
// pagination) and web/app/(app)/opportunities/page.tsx (pill view tabs).
//
// Copy discipline (PRODUCT.md): a PCA item is an intention, never a
// confirmed tender — the headline and the card both say "previstas"/
// "previsto", never a fact.
import type { Metadata } from "next";
import Link from "next/link";
import { RadarCard } from "@/components/radar-card";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Radar as RadarIcon } from "@/components/ui/icons";
import { Input, Label, Select } from "@/components/ui/input";
import { Toolbar } from "@/components/ui/toolbar";
import { requireSession } from "@/lib/auth";
import { formatCurrencyBRL } from "@/lib/format";
import {
  fetchRadarList,
  fetchRadarStateOptions,
  fetchRadarSummary,
  parseRadarFilters,
  type RadarFilters,
  type RadarView,
} from "@/lib/radar-list-queries";

export const metadata: Metadata = { title: "Radar" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const VIEW_TABS: { value: RadarView; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "saved", label: "Salvas" },
  { value: "ignored", label: "Ignoradas" },
];

const PERIOD_OPTIONS = [30, 60, 90, 180, 365] as const;

function buildQueryString(filters: RadarFilters, page?: number): string {
  const params = new URLSearchParams();
  if (filters.view !== "all") params.set("view", filters.view);
  filters.states.forEach((state) => params.append("state", state));
  if (filters.period !== null) params.set("period", String(filters.period));
  if (filters.minValue !== null) params.set("minValue", String(filters.minValue));
  if (filters.maxValue !== null) params.set("maxValue", String(filters.maxValue));
  if (filters.minScore !== null) params.set("minScore", String(filters.minScore));
  if (page && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function RadarPage({
  searchParams,
}: PageProps<"/radar">) {
  const session = await requireSession();
  const resolvedSearchParams = await searchParams;
  const filters = parseRadarFilters(resolvedSearchParams);

  const pageParam = resolvedSearchParams.page;
  const pageRaw = Array.isArray(pageParam) ? pageParam[0] : pageParam;
  const page = Math.max(1, Math.trunc(Number(pageRaw)) || 1);

  const companyId = session.user.companyId;

  const [rows, summary, stateOptions] = await Promise.all([
    fetchRadarList(companyId, filters, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    fetchRadarSummary(companyId, filters),
    fetchRadarStateOptions(companyId),
  ]);

  const totalPages = Math.max(1, Math.ceil(summary.total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
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

      <nav aria-label="Filtrar radar" className="flex items-center gap-1">
        {VIEW_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/radar${buildQueryString({ ...filters, view: tab.value })}`}
            className={`rounded-[9999px] px-3 py-1 text-[13px] font-medium transition-colors ${
              tab.value === filters.view
                ? "bg-ink text-surface"
                : "bg-surface-raised text-ink-muted hover:bg-line/60 hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <form method="GET" action="/radar">
        <input type="hidden" name="view" value={filters.view} />
        <Toolbar className="flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="radar-state">UF</Label>
            <Select
              id="radar-state"
              name="state"
              defaultValue={filters.states[0] ?? ""}
            >
              <option value="">Todas</option>
              {stateOptions.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="radar-period">Período</Label>
            <Select
              id="radar-period"
              name="period"
              defaultValue={filters.period ? String(filters.period) : ""}
            >
              <option value="">Todos os períodos</option>
              {PERIOD_OPTIONS.map((period) => (
                <option key={period} value={period}>
                  {period} dias
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="radar-min-value">Valor mín. (R$)</Label>
            <Input
              id="radar-min-value"
              type="number"
              name="minValue"
              defaultValue={filters.minValue ?? ""}
              placeholder="mín"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="radar-max-value">Valor máx. (R$)</Label>
            <Input
              id="radar-max-value"
              type="number"
              name="maxValue"
              defaultValue={filters.maxValue ?? ""}
              placeholder="máx"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="radar-min-score">Aderência mín.</Label>
            <Input
              id="radar-min-score"
              type="number"
              name="minScore"
              min={0}
              max={100}
              defaultValue={filters.minScore ?? ""}
              placeholder="0–100"
            />
          </div>

          <Button type="submit" size="sm">
            Aplicar
          </Button>
        </Toolbar>
      </form>

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
  filters: RadarFilters;
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
        href={`/radar${buildQueryString(filters, prev)}`}
        variant="ghost"
        size="sm"
        aria-disabled={isFirst}
        className={isFirst ? "pointer-events-none opacity-40" : undefined}
      >
        Anterior
      </LinkButton>
      <LinkButton
        href={`/radar${buildQueryString(filters, next)}`}
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
