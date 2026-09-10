import { Skeleton } from "@/components/ui/skeleton";

export default function ProcurementsLoading() {
  return (
    <div className="page-wide flex flex-col gap-5" aria-hidden="true">
      <Skeleton className="h-9" />

      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-14 border-b border-line" />
        ))}
      </div>
    </div>
  );
}
