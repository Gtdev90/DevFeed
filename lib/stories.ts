import { cacheLife } from "next/cache";
import type { AuthorKind, AuthorStories, FollowSpec, Story, StoriesResponse } from "@/types/stories";
import { fetchJson, isRecord, SourceError } from "./sources/parse";
import { PRESET_AUTHORS, authorFromSpec, searchUrl, selectStories } from "./stories-core";

/**
 * Recupera le storie di un autore da Hacker News (Algolia).
 * Cache di 10 minuti per autore; un errore non viene messo in cache.
 */
async function fetchAuthorStories(kind: AuthorKind, query: string): Promise<Story[]> {
  "use cache";
  cacheLife({ stale: 120, revalidate: 600, expire: 3600 });
  const spec: FollowSpec = {
    id: kind === "hn_user" ? `hn:${query}` : `domain:${query}`,
    kind,
    query,
  };
  const label = kind === "hn_user" ? `HN @${query}` : query;
  const payload = await fetchJson(label, searchUrl(spec));
  if (!isRecord(payload) || !Array.isArray(payload.hits)) {
    throw new SourceError(label, "formato risposta inatteso (campo `hits` mancante)");
  }
  return selectStories(spec, payload.hits);
}

/** Carica in parallelo (Promise.allSettled) le storie degli autori indicati. */
export async function getStories(specs: readonly FollowSpec[]): Promise<StoriesResponse> {
  const authors = specs.map(authorFromSpec);
  const settled = await Promise.allSettled(authors.map((a) => fetchAuthorStories(a.kind, a.query)));

  const result: AuthorStories[] = settled.map((outcome, i) =>
    outcome.status === "fulfilled"
      ? { author: authors[i], stories: outcome.value }
      : {
          author: authors[i],
          stories: [],
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        },
  );
  return { authors: result, fetchedAt: new Date().toISOString() };
}

export function presetSpecs(): FollowSpec[] {
  return PRESET_AUTHORS.map(({ id, kind, query }) => ({ id, kind, query }));
}
