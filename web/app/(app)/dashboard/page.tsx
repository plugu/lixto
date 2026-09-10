import { Suspense } from "react";
import { BreakdownSection } from "@/components/dashboard/breakdown-section";
import { DailySection } from "@/components/dashboard/daily-section";
import { KpiTiles } from "@/components/dashboard/kpi-tiles";
import {
  BreakdownSectionSkeleton,
  DailySectionSkeleton,
  KpiTilesSkeleton,
} from "@/components/dashboard/skeletons";
import { TodaySection } from "@/components/dashboard/today-section";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/lib/auth";
import { parseChartScope } from "@/lib/stats-queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const session = await requireSession();
  const resolved = await searchParams;
  const scope = parseChartScope(resolved.scope);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Visão geral" />

      <TodaySection companyId={session.user.companyId} />

      <Suspense fallback={<KpiTilesSkeleton />}>
        <KpiTiles />
      </Suspense>

      <Suspense fallback={<DailySectionSkeleton />}>
        <DailySection />
      </Suspense>

      <Suspense fallback={<BreakdownSectionSkeleton />}>
        <BreakdownSection scope={scope} />
      </Suspense>
    </div>
  );
}
