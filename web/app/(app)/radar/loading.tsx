import { Skeleton } from "@/components/ui/skeleton";

export default function RadarLoading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-8 w-1/2" />
      </div>

      <div className="flex items-center gap-1">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>

      <Skeleton className="h-16" />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[140px]" />
        ))}
      </div>
    </div>
  );
}
