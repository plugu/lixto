import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function ProcurementDetailLoading() {
  return (
    <div className="page-wide flex flex-col gap-6" aria-hidden="true">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/2" />

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <SkeletonText lines={8} />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
