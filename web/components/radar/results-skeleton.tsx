import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback for `results.tsx` — the headline and the card grid,
 * the two pieces of `/radar` that depend on filters. Shapes match
 * `app/(app)/radar/loading.tsx` (the route-level skeleton, which also covers
 * the pill tabs and the toolbar shell that now render immediately outside
 * this boundary). */
export function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-8 w-1/2" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[140px]" />
        ))}
      </div>
    </div>
  );
}
