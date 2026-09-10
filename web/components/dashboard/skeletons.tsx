// Suspense fallbacks for the streamed dashboard sections (ticket 142). Box
// sizes match the real sections (and `app/(app)/dashboard/loading.tsx`, from
// ticket 141) so nothing shifts once data arrives. `TodaySection` has no
// fallback here — it is awaited outside `<Suspense>` by the page.
import { Skeleton } from "@/components/ui/skeleton";

/** Fallback for `KpiTiles` — four stat tiles + the "por status" block it
 * renders in the same fetch. */
export function KpiTilesSkeleton() {
  return (
    <div className="flex flex-col gap-10" aria-hidden="true">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-[84px] rounded-[10px]" />
        <Skeleton className="h-[84px] rounded-[10px]" />
        <Skeleton className="h-[84px] rounded-[10px]" />
        <Skeleton className="h-[84px] rounded-[10px]" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}

/** Fallback for `DailySection` — matches `DailyLine`'s fixed 180px height. */
export function DailySectionSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-[180px]" />
    </div>
  );
}

/** Fallback for `BreakdownSection` — header row (title + scope pills) plus
 * the two-column bar-list grid. */
export function BreakdownSectionSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-64 rounded-[9999px]" />
      </div>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
