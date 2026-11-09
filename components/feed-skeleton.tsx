/** Placeholder di caricamento (solo struttura, nessun dato finto). */
export function FeedSkeleton() {
  return (
    <div aria-busy="true" aria-label="Caricamento del feed" className="space-y-8">
      <div className="h-7 w-72 animate-pulse rounded-md bg-obsidian-card" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-xl border border-line bg-obsidian-card"
          />
        ))}
      </div>
    </div>
  );
}
