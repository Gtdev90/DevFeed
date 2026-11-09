import { connection } from "next/server";
import { Landmark, Radio, ServerCrash } from "lucide-react";
import { getFeed } from "@/lib/feed";
import { FeedList } from "./feed-list";
import { SourceStatusBar } from "./source-status-bar";

function SectionTitle({
  id,
  icon,
  title,
  hint,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={id} className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
        {icon}
        {title}
      </h2>
      <p className="font-mono text-xs text-ink-mute">{hint}</p>
    </div>
  );
}

/** Server Component: legge i feed reali (stessa logica di /api/feed) e li passa alla UI. */
export async function FeedSection() {
  // I dati cambiano a ogni richiesta: il rendering parte solo a request-time.
  await connection();
  const { posts, sources, fetchedAt } = await getFeed();

  const live = posts.filter((p) => !p.isArchive);
  const archive = posts.filter((p) => p.isArchive);

  return (
    <div className="space-y-10">
      <SourceStatusBar sources={sources} />

      {posts.length === 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-glow/30 bg-amber-glow/5 p-5"
        >
          <ServerCrash aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-glow" />
          <div className="space-y-2 text-sm">
            <p className="font-medium text-ink">Nessuna fonte ha risposto.</p>
            <ul className="list-none space-y-1 font-mono text-xs text-ink-dim">
              {sources.map((s) => (
                <li key={s.id}>
                  {s.ok ? `${s.label}: nessun post` : s.error}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {live.length > 0 && (
        <section aria-labelledby="live-title">
          <SectionTitle
            id="live-title"
            icon={<Radio aria-hidden className="size-4 text-emerald-cyber" />}
            title="Live"
            hint={`${live.length} post · HN, Lobsters, Reddit`}
          />
          <FeedList posts={live} referenceIso={fetchedAt} label="Feed live" />
        </section>
      )}

      {archive.length > 0 && (
        <section aria-labelledby="archive-title">
          <SectionTitle
            id="archive-title"
            icon={<Landmark aria-hidden className="size-4 text-amber-glow" />}
            title="Pietre miliari"
            hint="oltre 700 punti su HN, prima del 2022"
          />
          <FeedList
            posts={archive}
            referenceIso={fetchedAt}
            label="Archivio storico"
            delay={0.5}
          />
        </section>
      )}
    </div>
  );
}
