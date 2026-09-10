// Server component: "Licitações publicadas por dia" — own fetch, own
// Suspense boundary so it streams independently of the KPI/status block
// above and the breakdown charts below.
import { DailyLine } from "@/components/charts/daily-line";
import { Section } from "@/components/ui/section";
import { fetchByDay } from "@/lib/stats-queries";

export async function DailySection() {
  const byDay = await fetchByDay();

  return (
    <Section title="Licitações publicadas por dia" eyebrow="Últimos 30 dias">
      <DailyLine data={byDay} />
    </Section>
  );
}
