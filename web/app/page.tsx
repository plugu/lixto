import { BarList } from "@/components/charts/bar-list";
import { DailyLine } from "@/components/charts/daily-line";
import { StatTile } from "@/components/charts/stat-tile";
import { StatusStack } from "@/components/charts/status-stack";
import {
  fetchPorDia,
  fetchPorModalidade,
  fetchPorPortal,
  fetchStatusCounts,
} from "@/lib/stats-queries";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [counts, porModalidade, porPortal, porDia] = await Promise.all([
    fetchStatusCounts(),
    fetchPorModalidade(),
    fetchPorPortal(),
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Licitações por modalidade">
          <BarList data={porModalidade} />
        </ChartCard>
        <ChartCard title="Licitações por portal">
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
