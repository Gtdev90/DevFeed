import { cacheLife } from "next/cache";
import type { TechPost } from "@/types/feed";
import {
  asNumber,
  asString,
  fetchJson,
  isoFromUnixSeconds,
  isRecord,
  SourceError,
  snippet,
  type JsonRecord,
} from "./parse";

const REDDIT_URL = "https://www.reddit.com/r/programming/hot.json?limit=15";

/** Senza uno User-Agent identificativo Reddit risponde 429. */
const REDDIT_HEADERS = { "User-Agent": "PulseDevApp/1.0" } as const;

/** Converte un post Reddit in `TechPost`; `null` se mancano i campi essenziali o è fissato in cima. */
export function normalizeRedditPost(data: JsonRecord): TechPost | null {
  const id = asString(data.id);
  const title = asString(data.title);
  const publishedAt = isoFromUnixSeconds(asNumber(data.created_utc));
  if (!id || !title || !publishedAt) return null;
  // I post "stickied" sono annunci dei moderatori, non contenuti da feed.
  if (data.stickied === true) return null;

  const permalink = asString(data.permalink);
  const discussionUrl = permalink ? `https://www.reddit.com${permalink}` : undefined;
  const url = data.is_self === true ? discussionUrl : (asString(data.url) ?? discussionUrl);
  if (!url) return null;

  const selftext = asString(data.selftext);
  const flair = asString(data.link_flair_text);

  return {
    id: `reddit-${id}`,
    title,
    url,
    source: "reddit",
    author: asString(data.author) ?? "unknown",
    points: asNumber(data.score) ?? 0,
    commentsCount: asNumber(data.num_comments) ?? 0,
    publishedAt,
    isArchive: false,
    ...(selftext ? { summarySnippet: snippet(selftext), rawContent: selftext } : {}),
    tags: ["r/programming", ...(flair ? [flair.toLowerCase()] : [])],
  };
}

/** Post "hot" di r/programming. Un errore non viene messo in cache. */
export async function fetchReddit(): Promise<TechPost[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  const payload = await fetchJson("Reddit", REDDIT_URL, REDDIT_HEADERS);
  if (
    !isRecord(payload) ||
    !isRecord(payload.data) ||
    !Array.isArray(payload.data.children)
  ) {
    throw new SourceError("Reddit", "formato risposta inatteso (campo `data.children` mancante)");
  }
  return payload.data.children.flatMap((child) => {
    if (!isRecord(child) || !isRecord(child.data)) return [];
    const post = normalizeRedditPost(child.data);
    return post ? [post] : [];
  });
}
