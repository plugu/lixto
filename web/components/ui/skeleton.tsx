export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      data-skeleton
      className={
        "animate-pulse rounded-md bg-surface-raised motion-reduce:animate-none " +
        className
      }
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={i === lines - 1 ? "h-3 w-2/3" : "h-3 w-full"}
        />
      ))}
    </div>
  );
}
