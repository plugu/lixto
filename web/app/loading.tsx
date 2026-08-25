export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col justify-center gap-2 px-4 py-10" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="h-11 animate-pulse rounded-md border-b border-line bg-surface-raised"
        />
      ))}
    </div>
  );
}
