import { Suspense } from "react";
import { FilterChips } from "@/components/filter-chips";
import { Filters } from "@/components/filters";
import { Results } from "@/components/procurements/results";
import { ResultsSkeleton } from "@/components/procurements/results-skeleton";
import { getSession } from "@/lib/auth";
import { getCompanyCnaes } from "@/lib/company-queries";
import { fetchModalityOptions, parseFilters } from "@/lib/procurement-queries";

export default async function ProcurementsPage({
  searchParams,
}: PageProps<"/procurements">) {
  const resolvedSearchParams = await searchParams;
  const filters = parseFilters(resolvedSearchParams);

  const pageParam = resolvedSearchParams.page;
  const pageRaw = Array.isArray(pageParam) ? pageParam[0] : pageParam;
  const page = Math.max(1, Math.trunc(Number(pageRaw)) || 1);

  // "Compatível com minha empresa": only logged-in visitors whose company has
  // at least one CNAE get the filter — everyone else has `compat` stripped so
  // the query, the toggle and the removable chip all agree it's absent
  // (`?compat=1` is a no-op when logged out).
  const session = await getSession();
  const companyCnaes = session
    ? (await getCompanyCnaes(session.user.companyId)).map((c) => c.cnae_code)
    : [];
  const showCompat = companyCnaes.length > 0;
  if (!showCompat) delete filters.compat;

  // Modality names label the chips, so they are awaited with the shell (one
  // cheap DISTINCT) instead of streaming — a chip that reads "6" for a beat
  // would be worse than the few ms this costs. Everything expensive (the
  // embedding call, the row query, the five facet queries) lives in
  // <Results> behind the Suspense boundary below.
  const modalityOptions = await fetchModalityOptions();

  return (
    <div className="page-wide flex flex-col gap-5">
      <Filters showCompat={showCompat} />

      <FilterChips
        modalityOptions={modalityOptions}
        showCompat={showCompat}
      />

      {/* Keyed on the full filter state so every filter or page change swaps
          the results for the skeleton while the toolbar, the chips and the
          sidebar stay mounted. */}
      <Suspense
        key={`${JSON.stringify(filters)}#${page}`}
        fallback={<ResultsSkeleton />}
      >
        <Results filters={filters} page={page} companyCnaes={companyCnaes} />
      </Suspense>
    </div>
  );
}
