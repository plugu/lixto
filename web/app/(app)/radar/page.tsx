// Radar list page (ticket 127; filters made live in ticket 145): the
// session company's matched, still-`predicted` future opportunities, ranked
// by match score, with view/state/period/value/score filters. Modelled on
// web/app/(app)/procurements/page.tsx (PageProps, requireSession, PAGE_SIZE,
// pagination, Suspense-keyed streaming) and
// web/app/(app)/opportunities/page.tsx (pill view tabs).
//
// The toolbar (`RadarFilterToolbar`) and the pill tabs never await the
// database and stay mounted across every filter change; the headline and
// the card grid depend on `filters`, so both live in `Results` (async
// server component) behind the Suspense boundary below.
//
// Copy discipline (PRODUCT.md): a PCA item is an intention, never a
// confirmed tender — the headline and the card both say "previstas"/
// "previsto", never a fact.
import type { Metadata } from "next";
import { Suspense } from "react";
import { RadarHeader } from "@/components/radar-header";
import { RadarFilterToolbar } from "@/components/radar/filter-toolbar";
import { Results } from "@/components/radar/results";
import { ResultsSkeleton } from "@/components/radar/results-skeleton";
import { PillTabs } from "@/components/ui/pill-tabs";
import { requireSession } from "@/lib/auth";
import {
  fetchRadarStateOptions,
  parseRadarFilters,
  type RadarView,
} from "@/lib/radar-list-queries";
import { RADAR_VIEW_DEFAULT } from "@/lib/url-state";

export const metadata: Metadata = { title: "Radar · Futuras" };
export const dynamic = "force-dynamic";

const VIEW_TABS: { value: RadarView; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "saved", label: "Salvas" },
  { value: "ignored", label: "Ignoradas" },
];

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

  // Doesn't depend on filters, so it's awaited with the shell alongside the
  // toolbar instead of streamed — mirrors `modalityOptions` in
  // app/(app)/procurements/page.tsx.
  const stateOptions = await fetchRadarStateOptions(companyId);

  return (
    <div className="flex flex-col gap-6">
      <RadarHeader active="future" />

      <PillTabs
        param="view"
        options={VIEW_TABS}
        defaultValue={RADAR_VIEW_DEFAULT}
        ariaLabel="Filtrar radar"
      />

      <RadarFilterToolbar stateOptions={stateOptions} />

      {/* Keyed on the full filter state so every filter or page change swaps
          the headline + results for the skeleton while the pill tabs and
          the toolbar stay mounted. */}
      <Suspense
        key={`${JSON.stringify(filters)}#${page}`}
        fallback={<ResultsSkeleton />}
      >
        <Results companyId={companyId} filters={filters} page={page} />
      </Suspense>
    </div>
  );
}
