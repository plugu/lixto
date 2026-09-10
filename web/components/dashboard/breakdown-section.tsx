// Server component: "por modalidade" + "por portal" breakdown charts, side by
// side under one `Section`. The scope pills (Abertas agora / Vão abrir /
// Tudo) live in this section's header `actions` slot as a `PillTabs`
// (ticket 143), which updates `?scope=` client-side without touching the
// `parseChartScope` contract.
import { PillTabs } from "@/components/ui/pill-tabs";
import { BarList } from "@/components/charts/bar-list";
import { Section } from "@/components/ui/section";
import {
  fetchByModality,
  fetchByPortal,
  type ChartScope,
} from "@/lib/stats-queries";
import { CHART_SCOPE_DEFAULT } from "@/lib/url-state";

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

function ScopePills() {
  return (
    <div className="flex items-center gap-1">
      <span className="mr-2 text-xs font-medium text-ink-muted">Escopo</span>
      <PillTabs
        param="scope"
        options={SCOPES}
        defaultValue={CHART_SCOPE_DEFAULT}
        ariaLabel="Escopo dos gráficos de modalidade e portal"
      />
    </div>
  );
}

export async function BreakdownSection({ scope }: { scope: ChartScope }) {
  const [byModality, byPortal] = await Promise.all([
    fetchByModality(scope),
    fetchByPortal(scope),
  ]);

  return (
    <Section title="Detalhamento" actions={<ScopePills />}>
      <p className="text-[13px] text-ink-muted">{SCOPE_SUBTITLES[scope]}</p>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h3 className="font-display text-[17px] leading-6 text-ink">
            Licitações por modalidade
          </h3>
          <BarList data={byModality} />
        </div>
        <div className="flex flex-col gap-4">
          <h3 className="font-display text-[17px] leading-6 text-ink">
            Licitações por portal
          </h3>
          <BarList data={byPortal} />
        </div>
      </div>
    </Section>
  );
}
