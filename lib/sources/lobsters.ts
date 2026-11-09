import { cacheLife } from "next/cache";
import type { TechPost } from "@/types/feed";
import {
  asNumber,
  asString,
  asStringArray,
  fetchJson,
  isRecord,
  SourceError,
  snippet,
  toIso,
  type JsonRecord,
} from "./parse";

const LOBSTERS_URL = "https://lobste.rs/hottest.json";

/** Lobsters espone l'autore come stringa (API attuale) o come oggetto `{ username }`. */
function submitterName(story: JsonRecord): string {
  const submitter = story.submitter_user ?? story.submitter;
  if (typeof submitter === "string" && submitter) return submitter;
  if (isRecord(submitter)) return asString(submitter.username) ?? "unknown";
  return "unknown";
}

/** Converte una storia Lobsters in `TechPost`; `null` se mancano i campi essenziali. */
export function normalizeLobstersStory(story: JsonRecord): TechPost | null {
  const shortId = asString(story.short_id);
  const title = asString(story.title);
  const publishedAt = toIso(story.created_at);
  if (!shortId || !title || !publishedAt) return null;

  const commentsUrl = asString(story.comments_url) ?? `https://lobste.rs/s/${shortId}`;
  // Le storie "solo testo" hanno `url` vuoto: si punta alla discussione.
  const url = asString(story.url) ?? commentsUrl;

  const description = asString(story.description_plain) ?? asString(story.description);

  return {
    id: `lobsters-${shortId}`,
    title,
    url,
    source: "lobsters",
    author: submitterName(story),
    points: asNumber(story.score) ?? 0,
    // L'API usa `comment_count`; si accetta anche `comments_count` per tolleranza.
    commentsCount: asNumber(story.comment_count) ?? asNumber(story.comments_count) ?? 0,
    publishedAt,
    isArchive: false,
    ...(description ? { summarySnippet: snippet(description) } : {}),
    tags: asStringArray(story.tags),
  };
}

/** Storie "hottest" di Lobsters. Un errore non viene messo in cache. */
export async function fetchLobsters(): Promise<TechPost[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  const payload = await fetchJson("Lobsters", LOBSTERS_URL);
  if (!Array.isArray(payload)) {
    throw new SourceError("Lobsters", "formato risposta inatteso (atteso un array)");
  }
  return payload.filter(isRecord).flatMap((story) => {
    const post = normalizeLobstersStory(story);
    return post ? [post] : [];
  });
}
