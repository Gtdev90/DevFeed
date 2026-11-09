import { connection } from "next/server";
import { ServerCrash } from "lucide-react";
import { getFeed } from "@/lib/feed";
import { FeedExperience } from "./feed-experience";
import { SourceStatusBar } from "./source-status-bar";

/** Server Component: legge i feed reali (stessa logica di /api/feed) e li passa alla UI. */
export async function FeedSection() {
  // I dati cambiano a ogni richiesta: il rendering parte solo a request-time.
  await connection();
  const { posts, sources, fetchedAt } = await getFeed();

  return (
    <div className="space-y-8">
      <SourceStatusBar sources={sources} />

      {posts.length === 0 ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-glow/30 bg-amber-glow/5 p-5"
        >
          <ServerCrash aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-glow" />
          <div className="space-y-2 text-sm">
            <p className="font-medium text-ink">Nessuna fonte ha risposto.</p>
            <ul className="list-none space-y-1 font-mono text-xs text-ink-dim">
              {sources.map((s) => (
                <li key={s.id}>{s.ok ? `${s.label}: nessun post` : s.error}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <FeedExperience posts={posts} fetchedAt={fetchedAt} />
      )}
    </div>
  );
}
