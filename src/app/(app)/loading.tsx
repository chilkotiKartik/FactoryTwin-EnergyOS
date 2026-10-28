export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-64 animate-pulse rounded bg-surface-3" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-3" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg bg-surface-3" />
    </div>
  );
}
