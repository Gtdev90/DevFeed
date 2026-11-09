/**
 * Logica pura delle Tech Stories: autori preimpostati, parsing degli handle da seguire,
 * normalizzazione degli hit Algolia e regola "non letto entro 72 ore".
 * Nessun accesso a rete, DOM o storage: testabile direttamente con node:test.
 */
import type { TechPost } from "@/types/feed";
import type { FollowSpec, Story, StoryAbstract, StoryAuthor } from "@/types/stories";
import { DIMENSIONS, DIMENSION_META, vectorizePost } from "./algorithm.ts";
import {
  asNumber,
  asString,
  asStringArray,
  hostnameOf,
  htmlToParagraphs,
  isRecord,
  snippet,
  toIso,
  type JsonRecord,
} from "./sources/parse.ts";

/** Una storia conta come "nuova" solo se pubblicata nelle ultime 72 ore. */
export const UNREAD_WINDOW_MS = 72 * 3_600_000;
/** Storie mostrate per autore. */
export const STORIES_PER_AUTHOR = 3;
export const MAX_FOLLOWED = 8;

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1/search_by_date";

export const PRESET_AUTHORS: readonly StoryAuthor[] = [
  {
    id: "hn:antirez",
    kind: "hn_user",
    query: "antirez",
    name: "Salvatore Sanfilippo",
    handle: "antirez",
    preset: true,
    avatarUrl: "https://github.com/antirez.png?size=160",
  },
  {
    id: "hn:mitchellh",
    kind: "hn_user",
    query: "mitchellh",
    name: "Mitchell Hashimoto",
    handle: "mitchellh",
    preset: true,
    avatarUrl: "https://github.com/mitchellh.png?size=160",
  },
  {
    id: "domain:jvns.ca",
    kind: "domain",
    query: "jvns.ca",
    name: "Julia Evans",
    handle: "b0rk",
    preset: true,
    avatarUrl: "https://github.com/jvns.png?size=160",
  },
  {
    id: "domain:danluu.com",
    kind: "domain",
    query: "danluu.com",
    name: "Dan Luu",
    handle: "danluu",
    preset: true,
    avatarUrl: "https://github.com/danluu.png?size=160",
  },
];

/* ───────────────────────── Parsing di ciò che l'utente vuole seguire ───────────────────────── */

const HN_USERNAME = /^[A-Za-z0-9_-]{2,15}$/;
const DOMAIN = /^(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/;

/**
 * Interpreta l'input libero dell'utente:
 *  - `antirez`, `@antirez`, `news.ycombinator.com/user?id=antirez` → utente HN
 *  - `jvns.ca`, `https://www.danluu.com/foo` → sito/blog (dominio)
 * Restituisce `null` se non è né un username né un dominio validi.
 */
export function parseFollowInput(raw: string): FollowSpec | null {
  const input = raw.trim().replace(/^@/, "");
  if (!input) return null;

  if (HN_USERNAME.test(input)) {
    return { id: `hn:${input}`, kind: "hn_user", query: input };
  }

  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "news.ycombinator.com") {
    const user = url.searchParams.get("id");
    return user && HN_USERNAME.test(user) ? { id: `hn:${user}`, kind: "hn_user", query: user } : null;
  }
  return DOMAIN.test(host) ? { id: `domain:${host}`, kind: "domain", query: host } : null;
}

/** Costruisce l'autore a partire da una fonte seguita dall'utente (o da un preset con lo stesso id). */
export function authorFromSpec(spec: FollowSpec): StoryAuthor {
  const preset = PRESET_AUTHORS.find((a) => a.id === spec.id);
  if (preset) return { ...preset };
  return { ...spec, name: spec.query, handle: spec.query, preset: false };
}

/** URL Algolia per l'autore. Per i domini si scaricano più hit e si filtra per host reale. */
export function searchUrl(author: FollowSpec): string {
  return author.kind === "hn_user"
    ? `${ALGOLIA_BASE}?tags=author_${encodeURIComponent(author.query)}&hitsPerPage=${STORIES_PER_AUTHOR}`
    : `${ALGOLIA_BASE}?query=${encodeURIComponent(author.query)}&tags=story&hitsPerPage=20`;
}

/* ───────────────────────── Normalizzazione ───────────────────────── */

const cut = (text: string, max: number) => (text.length <= max ? text : snippet(text, max));

function topicsOf(title: string, text: string): string[] {
  const pseudoPost: TechPost = {
    id: "story",
    title,
    url: "",
    source: "hacker_news",
    author: "",
    points: 0,
    commentsCount: 0,
    publishedAt: new Date(0).toISOString(),
    isArchive: false,
    summarySnippet: text,
    tags: [],
  };
  const { vector, confidence } = vectorizePost(pseudoPost);
  if (confidence === 0) return [];
  return [...vector.keys()]
    .sort((a, b) => vector[b] - vector[a])
    .filter((i) => vector[i] >= 0.35)
    .slice(0, 3)
    .map((i) => DIMENSION_META[DIMENSIONS[i]].short);
}

function buildAbstract(opts: {
  kicker: string;
  title: string;
  paragraphs: string[];
  facts: { label: string; value: string }[];
}): StoryAbstract {
  const [lead, ...rest] = opts.paragraphs;
  return {
    kicker: opts.kicker,
    ...(lead ? { lead: cut(lead, 260) } : {}),
    bullets: rest.slice(0, 2).map((p) => cut(p, 160)),
    facts: opts.facts,
    topics: topicsOf(opts.title, opts.paragraphs.join(" ")),
  };
}

/** Converte un hit Algolia (articolo o commento) in `Story`; `null` se mancano i campi essenziali. */
export function normalizeStoryHit(hit: JsonRecord, authorId: string): Story | null {
  const objectId = asString(hit.objectID);
  const publishedAt = toIso(hit.created_at);
  if (!objectId || !publishedAt) return null;

  const tags = asStringArray(hit._tags);
  const commentHtml = asString(hit.comment_text);
  const isComment = tags.includes("comment") || commentHtml !== undefined;
  const discussionUrl = `https://news.ycombinator.com/item?id=${objectId}`;

  if (isComment) {
    const parentTitle = asString(hit.story_title);
    if (!commentHtml) return null;
    const parentId = asString(hit.story_id) ?? (typeof hit.story_id === "number" ? String(hit.story_id) : undefined);
    const parentDiscussion = parentId ? `https://news.ycombinator.com/item?id=${parentId}` : discussionUrl;
    const parentUrl = asString(hit.story_url) ?? parentDiscussion;
    const title = parentTitle ?? "Commento su Hacker News";
    const host = hostnameOf(parentUrl);
    return {
      id: `story-${objectId}`,
      authorId,
      kind: "comment",
      title,
      url: parentUrl,
      discussionUrl,
      publishedAt,
      points: 0,
      commentsCount: 0,
      abstract: buildAbstract({
        kicker: "Commento su HN",
        title,
        paragraphs: htmlToParagraphs(commentHtml),
        facts: [
          ...(host && parentUrl !== parentDiscussion ? [{ label: "Discussione su", value: host }] : []),
          { label: "Tipo", value: "Pensiero in una discussione" },
        ],
      }),
    };
  }

  const title = asString(hit.title) ?? asString(hit.story_title);
  if (!title) return null;
  const externalUrl = asString(hit.url);
  const points = asNumber(hit.points) ?? 0;
  const comments = asNumber(hit.num_comments) ?? 0;
  const host = externalUrl ? hostnameOf(externalUrl) : undefined;
  const kicker = tags.includes("show_hn") ? "Show HN" : tags.includes("ask_hn") ? "Ask HN" : "Articolo";
  const body = asString(hit.story_text);

  return {
    id: `story-${objectId}`,
    authorId,
    kind: "story",
    title,
    url: externalUrl ?? discussionUrl,
    discussionUrl,
    publishedAt,
    points,
    commentsCount: comments,
    abstract: buildAbstract({
      kicker,
      title,
      paragraphs: body ? htmlToParagraphs(body) : [],
      facts: [
        ...(host ? [{ label: "Fonte", value: host }] : []),
        { label: "Punti", value: String(points) },
        { label: "Commenti", value: String(comments) },
      ],
    }),
  };
}

/**
 * Dagli hit grezzi alle storie dell'autore: normalizza, per i domini tiene solo i link
 * che puntano davvero al sito, ordina dalla più recente e limita a 3.
 */
export function selectStories(author: FollowSpec, hits: readonly unknown[]): Story[] {
  const stories: Story[] = [];
  for (const hit of hits) {
    if (!isRecord(hit)) continue;
    if (author.kind === "domain") {
      const host = hostnameOf(asString(hit.url) ?? "");
      if (!host || (host !== author.query && !host.endsWith(`.${author.query}`))) continue;
    }
    const story = normalizeStoryHit(hit, author.id);
    if (story) stories.push(story);
  }
  return stories
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, STORIES_PER_AUTHOR);
}

/* ───────────────────────── Stato "letto / non letto" ───────────────────────── */

/** true se l'autore ha almeno una storia non vista pubblicata nelle ultime 72 ore. */
export function hasUnread(stories: readonly Story[], viewed: ReadonlySet<string>, nowMs: number): boolean {
  return stories.some(
    (s) => !viewed.has(s.id) && nowMs - Date.parse(s.publishedAt) <= UNREAD_WINDOW_MS,
  );
}

/** Storie in ordine cronologico (dalla più vecchia), come in un viewer a storie. */
export function chronological(stories: readonly Story[]): Story[] {
  return [...stories].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
}

/** Indice da cui far partire il viewer: la prima storia non vista, altrimenti la prima. */
export function startIndex(ordered: readonly Story[], viewed: ReadonlySet<string>): number {
  const i = ordered.findIndex((s) => !viewed.has(s.id));
  return i === -1 ? 0 : i;
}

export function formatAge(publishedAt: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(publishedAt)) / 60_000));
  if (minutes < 1) return "adesso";
  if (minutes < 60) return `${minutes}m fa`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h fa`;
  const days = Math.floor(minutes / (24 * 60));
  return days < 30 ? `${days}g fa` : new Date(publishedAt).toLocaleDateString("it-IT", { month: "short", year: "numeric", timeZone: "UTC" });
}
