import type { FeedResponse, SourceId, SourceStatus, TechPost } from "@/types/feed";
import { fetchHnArchive, fetchHnFrontPage } from "./sources/hacker-news";
import { fetchLobsters } from "./sources/lobsters";
import { fetchReddit } from "./sources/reddit";

interface SourceJob {
  id: SourceId;
  label: string;
  run: () => Promise<TechPost[]>;
}

const SOURCE_JOBS: readonly SourceJob[] = [
  { id: "hn_front_page", label: "Hacker News", run: fetchHnFrontPage },
  { id: "hn_archive", label: "HN Archivio", run: fetchHnArchive },
  { id: "lobsters", label: "Lobsters", run: fetchLobsters },
  { id: "reddit", label: "Reddit", run: fetchReddit },
];

/** Alterna i post delle varie fonti mantenendo l'ordine "hot" originale di ciascuna. */
function interleave(lists: TechPost[][]): TechPost[] {
  const out: TechPost[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const post = list[i];
      if (post) out.push(post);
    }
  }
  return out;
}

/** Elimina i duplicati per `id`; se un post compare più volte vince il flag archivio. */
function dedupe(posts: TechPost[]): TechPost[] {
  const byId = new Map<string, TechPost>();
  for (const post of posts) {
    const existing = byId.get(post.id);
    byId.set(post.id, existing ? { ...existing, isArchive: existing.isArchive || post.isArchive } : post);
  }
  return [...byId.values()];
}

/**
 * Recupera in parallelo tutte le fonti: il fallimento di una non compromette le altre.
 * Ordine del risultato: prima il feed live (fonti alternate), poi le pietre miliari.
 */
export async function getFeed(): Promise<FeedResponse> {
  const settled = await Promise.allSettled(SOURCE_JOBS.map((job) => job.run()));

  const sources: SourceStatus[] = [];
  const live: TechPost[][] = [];
  const archive: TechPost[] = [];

  settled.forEach((result, index) => {
    const { id, label } = SOURCE_JOBS[index];
    if (result.status === "rejected") {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      sources.push({ id, label, ok: false, error });
      return;
    }
    sources.push({ id, label, ok: true, count: result.value.length });
    if (id === "hn_archive") archive.push(...result.value);
    else live.push(result.value);
  });

  const posts = dedupe([...interleave(live), ...archive]);
  const liveFirst = [...posts.filter((p) => !p.isArchive), ...posts.filter((p) => p.isArchive)];

  return { posts: liveFirst, sources, fetchedAt: new Date().toISOString() };
}
