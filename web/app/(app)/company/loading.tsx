import { Skeleton } from "@/components/ui/skeleton";

export default function CompanyLoading() {
  return (
    <div className="flex flex-col gap-8" aria-hidden="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-96" />
    </div>
  );
}
