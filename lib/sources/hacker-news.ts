import { cacheLife } from "next/cache";
import type { TechPost } from "@/types/feed";
import {
  asNumber,
  asString,
  asStringArray,
  fetchJson,
  hostnameOf,
  isRecord,
  SourceError,
  stripHtml,
  snippet,
  toIso,
  type JsonRecord,
} from "./parse";

const HN_FRONT_PAGE_URL =
  "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=25";

/** Pietre miliari: oltre 700 punti e pubblicate prima del 1° gennaio 2022 (UTC). */
const HN_ARCHIVE_URL =
  "https://hn.algolia.com/api/v1/search?tags=story&numericFilters=points>700,created_at_i<1640995200&hitsPerPage=10";

function extractHits(source: string, payload: unknown): JsonRecord[] {
  if (!isRecord(payload) || !Array.isArray(payload.hits)) {
    throw new SourceError(source, "formato risposta inatteso (campo `hits` mancante)");
  }
  return payload.hits.filter(isRecord);
}

/** Converte un hit Algolia in `TechPost`; `null` se mancano i campi essenziali. */
export function normalizeHnHit(hit: JsonRecord, isArchive: boolean): TechPost | null {
  const objectId = asString(hit.objectID);
  const title = asString(hit.title) ?? asString(hit.story_title);
  const publishedAt = toIso(hit.created_at);
  if (!objectId || !title || !publishedAt) return null;

  const discussionUrl = `https://news.ycombinator.com/item?id=${objectId}`;
  // Ask HN e simili non hanno un link esterno: si punta alla discussione.
  const url = asString(hit.url) ?? discussionUrl;

  const hintTags = asStringArray(hit._tags);
  const tags: string[] = [];
  if (hintTags.includes("show_hn")) tags.push("show_hn");
  if (hintTags.includes("ask_hn")) tags.push("ask_hn");
  const host = hostnameOf(url);
  if (host && url !== discussionUrl) tags.push(host);

  const body = asString(hit.story_text);
  const plain = body ? stripHtml(body) : undefined;

  return {
    id: `hn-${objectId}`,
    title,
    url,
    source: "hacker_news",
    author: asString(hit.author) ?? "unknown",
    points: asNumber(hit.points) ?? 0,
    commentsCount: asNumber(hit.num_comments) ?? 0,
    publishedAt,
    isArchive,
    ...(plain ? { summarySnippet: snippet(plain), rawContent: body } : {}),
    tags,
  };
}

function normalizeHits(hits: JsonRecord[], isArchive: boolean): TechPost[] {
  return hits.flatMap((hit) => {
    const post = normalizeHnHit(hit, isArchive);
    return post ? [post] : [];
  });
}

/** Front page di Hacker News in tempo reale. Un errore non viene messo in cache. */
export async function fetchHnFrontPage(): Promise<TechPost[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  const payload = await fetchJson("Hacker News", HN_FRONT_PAGE_URL);
  return normalizeHits(extractHits("Hacker News", payload), false);
}

/** Archivio storico di Hacker News: cambia di rado, quindi cache lunga. */
export async function fetchHnArchive(): Promise<TechPost[]> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 86400, expire: 604800 });
  const payload = await fetchJson("Hacker News (archivio)", HN_ARCHIVE_URL);
  return normalizeHits(extractHits("Hacker News (archivio)", payload), true);
}
