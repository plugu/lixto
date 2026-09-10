// Presentational: "Licitações por status" — takes the counts fetched once by
// `KpiTiles` (see ticket 142) rather than querying again. Split into its own
// file so `skeletons.tsx` can mirror it with a matching fallback shape.
import { StatusStack } from "@/components/charts/status-stack";
import { Section } from "@/components/ui/section";
import type { StatusCounts } from "@/lib/stats-queries";

export function StatusSection({ counts }: { counts: StatusCounts }) {
  return (
    <Section title="Licitações por status">
      <StatusStack counts={counts} />
    </Section>
  );
}
