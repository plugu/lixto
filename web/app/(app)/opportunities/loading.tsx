import { Skeleton } from "@/components/ui/skeleton";

export default function OpportunitiesLoading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <Skeleton className="h-8 w-64" />

      <Skeleton className="h-14" />

      <div className="flex items-center gap-1">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[168px]" />
        ))}
      </div>
    </div>
  );
}
