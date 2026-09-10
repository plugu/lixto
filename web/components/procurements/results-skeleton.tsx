import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback for `results.tsx`. Row heights match
 * `app/(app)/procurements/loading.tsx` so the route-level skeleton and the
 * in-page one are the same shape and nothing jumps between them. */
export function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-14 border-b border-line" />
      ))}
    </div>
  );
}
