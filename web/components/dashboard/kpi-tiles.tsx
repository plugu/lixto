// Server component: the four KPI tiles + "Licitações por status" — one
// `fetchStatusCounts()` call shared between both (ticket 142: no query runs
// twice per request). Kept as a single Suspense boundary since they resolve
// together; `StatusSection` stays its own file/fallback for layout clarity.
import { StatTile } from "@/components/charts/stat-tile";
import { StatusSection } from "@/components/dashboard/status-section";
import { fetchStatusCounts } from "@/lib/stats-queries";

export async function KpiTiles() {
  const counts = await fetchStatusCounts();

  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Licitações no total" value={counts.total} />
        <StatTile label="Abertas agora" value={counts.open} />
        <StatTile label="Vão abrir" value={counts.upcoming} />
        <StatTile label="Publicadas nas últimas 24h" value={counts.new24h} />
      </div>
      <StatusSection counts={counts} />
    </div>
  );
}
