import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { DailyLine } from "@/components/charts/daily-line";
import { StatTile } from "@/components/charts/stat-tile";
import { StatusStack } from "@/components/charts/status-stack";
import { Section } from "@/components/ui/section";
import {
  fetchByDay,
  fetchByModality,
  fetchByPortal,
  fetchStatusCounts,
  parseChartScope,
  type ChartScope,
} from "@/lib/stats-queries";

export const dynamic = "force-dynamic";

const SCOPES: { value: ChartScope; label: string }[] = [
  { value: "open", label: "Abertas agora" },
  { value: "upcoming", label: "Vão abrir" },
  { value: "all", label: "Tudo" },
];

const SCOPE_SUBTITLES: Record<ChartScope, string> = {
  open: "Somente licitações abertas agora",
  upcoming: "Somente licitações que vão abrir",
  all: "Todas as licitações sincronizadas",
};

export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const resolved = await searchParams;
  const scope = parseChartScope(resolved.scope);

  const [counts, byModality, byPortal, byDay] = await Promise.all([
    fetchStatusCounts(),
    fetchByModality(scope),
    fetchByPortal(scope),
    fetchByDay(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <h1 className="font-display text-[30px] leading-[34px] text-ink">
        Visão geral
      </h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Licitações no total" value={counts.total} />
        <StatTile label="Abertas agora" value={counts.open} />
        <StatTile label="Vão abrir" value={counts.upcoming} />
        <StatTile label="Publicadas nas últimas 24h" value={counts.new24h} />
      </div>

      <Section title="Licitações por status">
        <StatusStack counts={counts} />
      </Section>

      <Section title="Licitações publicadas por dia" eyebrow="Últimos 30 dias">
        <DailyLine data={byDay} />
      </Section>

      <nav
        aria-label="Escopo dos gráficos de modalidade e portal"
        className="flex items-center gap-1"
      >
        <span className="mr-2 text-xs font-medium text-ink-muted">Escopo</span>
        {SCOPES.map((s) => (
          <Link
            key={s.value}
            href={s.value === "open" ? "/dashboard" : `/dashboard?scope=${s.value}`}
            className={`rounded-[9999px] px-3 py-1 text-[13px] font-medium transition-colors ${
              s.value === scope
                ? "bg-ink text-surface"
                : "bg-surface-raised text-ink-muted hover:bg-line/60 hover:text-ink"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Section title="Licitações por modalidade">
          <p className="text-[13px] text-ink-muted">{SCOPE_SUBTITLES[scope]}</p>
          <BarList data={byModality} />
        </Section>
        <Section title="Licitações por portal">
          <p className="text-[13px] text-ink-muted">{SCOPE_SUBTITLES[scope]}</p>
          <BarList data={byPortal} />
        </Section>
      </div>
    </div>
  );
}
