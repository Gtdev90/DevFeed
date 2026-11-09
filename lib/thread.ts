import { cacheLife } from "next/cache";
import type { ArticleContent, ThreadContext } from "@/types/context";
import { fetchHtml } from "./net/safe-fetch";
import { extractArticle } from "./net/article";
import { fetchJson, SourceError } from "./sources/parse";
import {
  articleFromSelfText,
  buildCommentsSummary,
  normalizeHnItem,
  normalizeLobstersStory,
  normalizeRedditThread,
  parsePostId,
  type RawThread,
} from "./thread-core";

// Gli host delle discussioni sono fissi: l'id del post decide solo il percorso, mai l'host.

async function fetchHnThread(id: string): Promise<RawThread> {
  "use cache";
  cacheLife({ stale: 120, revalidate: 600, expire: 3600 });
  const json = await fetchJson("Hacker News", `https://hn.algolia.com/api/v1/items/${id}`);
  const thread = normalizeHnItem(json, id);
  if (!thread) throw new SourceError("Hacker News", "thread non valido");
  return thread;
}

async function fetchLobstersThread(id: string): Promise<RawThread> {
  "use cache";
  cacheLife({ stale: 120, revalidate: 600, expire: 3600 });
  const json = await fetchJson("Lobsters", `https://lobste.rs/s/${id}.json`);
  const thread = normalizeLobstersStory(json, id);
  if (!thread) throw new SourceError("Lobsters", "thread non valido");
  return thread;
}

async function fetchRedditThread(id: string): Promise<RawThread> {
  "use cache";
  cacheLife({ stale: 120, revalidate: 600, expire: 3600 });
  const json = await fetchJson("Reddit", `https://www.reddit.com/comments/${id}.json?limit=40&sort=top&raw_json=1`, {
    "User-Agent": "PulseDevApp/1.0",
  });
  const thread = normalizeRedditThread(json, id);
  if (!thread) throw new SourceError("Reddit", "thread non valido");
  return thread;
}

/** Articolo sorgente: cache di 1 ora; se non è leggibile lancia (e quindi non viene cachato). */
async function fetchArticle(url: string): Promise<ArticleContent> {
  "use cache";
  cacheLife({ stale: 600, revalidate: 3600, expire: 86_400 });
  const page = await fetchHtml(url);
  if (!page.ok) throw new Error(page.reason);
  const article = extractArticle(page.html, page.finalUrl);
  if (!article) throw new Error("nessun testo leggibile nella pagina");
  return article;
}

/** Contesto completo di un post: discussione + articolo. `null` se l'id non è valido. */
export async function getThreadContext(postId: string): Promise<ThreadContext | null> {
  const parsed = parsePostId(postId);
  if (!parsed) return null;

  let thread: RawThread;
  try {
    thread =
      parsed.source === "hacker_news" ? await fetchHnThread(parsed.externalId)
      : parsed.source === "lobsters" ? await fetchLobstersThread(parsed.externalId)
      : await fetchRedditThread(parsed.externalId);
  } catch (err) {
    // Senza thread non c'è nemmeno l'URL dell'articolo: errore esplicito per il chiamante.
    throw err instanceof Error ? err : new Error(String(err));
  }

  let article: ArticleContent | null = null;
  let articleError: string | undefined;
  if (thread.articleUrl) {
    try {
      article = await fetchArticle(thread.articleUrl);
    } catch (err) {
      articleError = err instanceof Error ? err.message : "articolo non raggiungibile";
    }
  }
  // Post senza link esterno (Ask HN, self post) o articolo non leggibile: il testo del post è la fonte.
  if (!article && thread.selfText) {
    article = articleFromSelfText(thread.selfText, thread.discussionUrl, thread.title);
    articleError = undefined;
  }

  return {
    postId,
    discussionUrl: thread.discussionUrl,
    article,
    ...(article ? {} : { articleError: articleError ?? (thread.articleUrl ? undefined : "il post non ha un testo esterno") }),
    comments: thread.comments,
    commentsSummary: buildCommentsSummary(thread.comments),
    fetchedAt: new Date().toISOString(),
  };
}
