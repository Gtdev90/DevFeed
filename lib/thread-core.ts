/**
 * Normalizzazione pura dei thread di Hacker News (Algolia), Lobsters e Reddit in
 * un formato comune, più il digest dei commenti per il prompt. Nessun accesso a rete.
 */
import type { ArticleContent, ThreadComment } from "../types/context.ts";
import { asNumber, asString, htmlToParagraphs, isRecord, snippet } from "./sources/parse.ts";

export type PostSource = "hacker_news" | "lobsters" | "reddit";

/** Riconosce l'origine dall'id del post e ne estrae l'id originale. Rifiuta tutto il resto. */
export function parsePostId(postId: string): { source: PostSource; externalId: string } | null {
  let m = /^hn-(\d{1,12})$/.exec(postId);
  if (m) return { source: "hacker_news", externalId: m[1] };
  m = /^lobsters-([a-z0-9]{3,12})$/.exec(postId);
  if (m) return { source: "lobsters", externalId: m[1] };
  m = /^reddit-([a-z0-9]{1,12})$/.exec(postId);
  if (m) return { source: "reddit", externalId: m[1] };
  return null;
}

export interface RawThread {
  discussionUrl: string;
  /** Link esterno dell'articolo, se esiste. */
  articleUrl?: string;
  /** Testo del post stesso (Ask HN, self post Reddit, descrizione Lobsters). */
  selfText?: string;
  title?: string;
  comments: ThreadComment[];
}

export const MAX_COMMENTS = 40;
const MAX_COMMENT_CHARS = 900;
const MAX_DEPTH = 2;

const DEAD = /^\[(deleted|removed|dead)\]$/i;

function pushComment(out: ThreadComment[], c: ThreadComment): boolean {
  if (out.length >= MAX_COMMENTS) return false;
  if (!c.text || DEAD.test(c.text)) return true;
  out.push({ ...c, text: snippet(c.text, MAX_COMMENT_CHARS) });
  return true;
}

/** Risposta di `https://hn.algolia.com/api/v1/items/<id>`. */
export function normalizeHnItem(json: unknown, id: string): RawThread | null {
  if (!isRecord(json)) return null;
  const comments: ThreadComment[] = [];
  const walk = (nodes: unknown, depth: number) => {
    if (!Array.isArray(nodes) || depth > MAX_DEPTH) return;
    let taken = 0;
    for (const node of nodes) {
      if (!isRecord(node)) continue;
      const html = asString(node.text);
      if (html) {
        if (!pushComment(comments, {
          id: `c${String(node.id ?? comments.length)}`,
          author: asString(node.author) ?? "unknown",
          text: htmlToParagraphs(html).join(" "),
          score: asNumber(node.points),
          depth,
        })) return;
        taken++;
      }
      // Le risposte annidate: poche per ramo, così il digest copre più thread diversi.
      if (depth < MAX_DEPTH && taken <= 3) walk(node.children, depth + 1);
    }
  };
  walk(json.children, 0);

  const selfHtml = asString(json.text);
  return {
    discussionUrl: `https://news.ycombinator.com/item?id=${id}`,
    articleUrl: asString(json.url),
    selfText: selfHtml ? htmlToParagraphs(selfHtml).join("\n\n") : undefined,
    title: asString(json.title),
    comments,
  };
}

/** Risposta di `https://lobste.rs/s/<id>.json`. */
export function normalizeLobstersStory(json: unknown, id: string): RawThread | null {
  if (!isRecord(json)) return null;
  const comments: ThreadComment[] = [];
  if (Array.isArray(json.comments)) {
    for (const c of json.comments) {
      if (!isRecord(c)) continue;
      const depth = Math.max(0, (asNumber(c.indent_level) ?? 1) - 1);
      if (depth > MAX_DEPTH) continue;
      const user = c.commenting_user;
      const author = typeof user === "string" ? user : isRecord(user) ? asString(user.username) : undefined;
      if (!pushComment(comments, {
        id: `c${asString(c.short_id) ?? comments.length}`,
        author: author ?? "unknown",
        text: asString(c.comment_plain) ?? "",
        score: asNumber(c.score),
        depth,
      })) break;
    }
  }
  return {
    discussionUrl: asString(json.comments_url) ?? `https://lobste.rs/s/${id}`,
    articleUrl: asString(json.url),
    selfText: asString(json.description_plain),
    title: asString(json.title),
    comments,
  };
}

const REDDIT_HOST = /(^|\.)(reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com)$/i;

/** Risposta di `https://www.reddit.com/comments/<id>.json`. */
export function normalizeRedditThread(json: unknown, id: string): RawThread | null {
  if (!Array.isArray(json) || json.length < 2) return null;
  const postNode = (json[0] as { data?: { children?: { data?: unknown }[] } })?.data?.children?.[0]?.data;
  if (!isRecord(postNode)) return null;

  const comments: ThreadComment[] = [];
  const walk = (listing: unknown, depth: number) => {
    const children = isRecord(listing) && isRecord(listing.data) && Array.isArray(listing.data.children) ? listing.data.children : [];
    for (const child of children) {
      if (!isRecord(child) || child.kind !== "t1" || !isRecord(child.data)) continue;
      const d = child.data;
      if (!pushComment(comments, {
        id: `c${asString(d.id) ?? comments.length}`,
        author: asString(d.author) ?? "unknown",
        text: (asString(d.body) ?? "").replace(/\s+/g, " ").trim(),
        score: asNumber(d.score),
        depth,
      })) return;
      if (depth < MAX_DEPTH) walk(d.replies, depth + 1);
    }
  };
  walk(json[1], 0);

  const external = asString(postNode.url);
  let articleUrl: string | undefined;
  if (postNode.is_self !== true && external) {
    try {
      articleUrl = REDDIT_HOST.test(new URL(external).hostname) ? undefined : external;
    } catch {
      articleUrl = undefined;
    }
  }
  const permalink = asString(postNode.permalink);
  return {
    discussionUrl: permalink ? `https://www.reddit.com${permalink}` : `https://www.reddit.com/comments/${id}`,
    articleUrl,
    selfText: asString(postNode.selftext),
    title: asString(postNode.title),
    comments,
  };
}

/** Digest dei commenti per il prompt: prima i top-level, poi le risposte; max ~6000 caratteri. */
export function buildCommentsSummary(comments: readonly ThreadComment[], maxChars = 6000): string {
  const ordered = [...comments].sort((a, b) => a.depth - b.depth);
  const lines: string[] = [];
  let total = 0;
  for (const c of ordered) {
    const line = `${c.depth > 0 ? "↳ " : ""}${c.author}${c.score !== undefined ? ` (${c.score})` : ""}: ${snippet(c.text, 450)}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join("\n");
}

/** Trasforma il testo di un post (Ask HN, self post) in "articolo" da mostrare e riassumere. */
export function articleFromSelfText(text: string, url: string, title?: string): ArticleContent {
  const clean = text.trim();
  return { url, title, text: clean, wordCount: clean.split(/\s+/).filter(Boolean).length, truncated: false };
}
