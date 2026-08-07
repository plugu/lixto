import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { DailyLine } from "@/components/charts/daily-line";
import { StatTile } from "@/components/charts/stat-tile";
import { StatusStack } from "@/components/charts/status-stack";
import {
  fetchPorDia,
  fetchPorModalidade,
  fetchPorPortal,
  fetchStatusCounts,
  parseChartScope,
  type ChartScope,
} from "@/lib/stats-queries";

export const dynamic = "force-dynamic";

const SCOPES: { value: ChartScope; label: string }[] = [
  { value: "abertas", label: "Abertas agora" },
  { value: "vai_abrir", label: "Vão abrir" },
  { value: "tudo", label: "Tudo" },
];

const SCOPE_SUBTITLES: Record<ChartScope, string> = {
  abertas: "Somente licitações abertas agora",
  vai_abrir: "Somente licitações que vão abrir",
  tudo: "Todas as licitações desde jan/2026",
};

export default async function Dashboard({ searchParams }: PageProps<"/">) {
  const resolved = await searchParams;
  const scope = parseChartScope(resolved.escopo);

  const [counts, porModalidade, porPortal, porDia] = await Promise.all([
    fetchStatusCounts(),
    fetchPorModalidade(scope),
    fetchPorPortal(scope),
    fetchPorDia(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Visão geral
      </h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Licitações no total" value={counts.total} />
        <StatTile label="Abertas agora" value={counts.abertas} />
        <StatTile label="Vão abrir" value={counts.vaiAbrir} />
        <StatTile label="Publicadas nas últimas 24h" value={counts.novas24h} />
      </div>

      <ChartCard title="Licitações por status">
        <StatusStack counts={counts} />
      </ChartCard>

      <ChartCard title="Licitações publicadas por dia" subtitle="Últimos 30 dias">
        <DailyLine data={porDia} />
      </ChartCard>

      <nav
        aria-label="Escopo dos gráficos de modalidade e portal"
        className="flex items-center gap-1 pt-2"
      >
        <span className="mr-2 text-xs font-medium text-muted-foreground">
          Escopo
        </span>
        {SCOPES.map((s) => (
          <Link
            key={s.value}
            href={s.value === "abertas" ? "/" : `/?escopo=${s.value}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              s.value === scope
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="Licitações por modalidade"
          subtitle={SCOPE_SUBTITLES[scope]}
        >
          <BarList data={porModalidade} />
        </ChartCard>
        <ChartCard
          title="Licitações por portal"
          subtitle={SCOPE_SUBTITLES[scope]}
        >
          <BarList data={porPortal} />
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-subtle">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </header>
      {children}
    </section>
  );
}
