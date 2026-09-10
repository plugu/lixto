import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-10" aria-hidden="true">
      <Skeleton className="h-8 w-64" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-[84px] rounded-[10px]" />
        <Skeleton className="h-[84px] rounded-[10px]" />
        <Skeleton className="h-[84px] rounded-[10px]" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-[84px] rounded-[10px]" />
        <Skeleton className="h-[84px] rounded-[10px]" />
        <Skeleton className="h-[84px] rounded-[10px]" />
        <Skeleton className="h-[84px] rounded-[10px]" />
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
