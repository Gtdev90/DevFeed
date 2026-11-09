import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PRESET_AUTHORS,
  UNREAD_WINDOW_MS,
  authorFromSpec,
  chronological,
  hasUnread,
  normalizeStoryHit,
  parseFollowInput,
  searchUrl,
  selectStories,
  startIndex,
} from "./stories-core.ts";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("autori preimpostati e URL", () => {
  it("usa gli endpoint Algolia richiesti", () => {
    const urls = Object.fromEntries(PRESET_AUTHORS.map((a) => [a.handle, searchUrl(a)]));
    assert.equal(urls.antirez, "https://hn.algolia.com/api/v1/search_by_date?tags=author_antirez&hitsPerPage=3");
    assert.equal(urls.mitchellh, "https://hn.algolia.com/api/v1/search_by_date?tags=author_mitchellh&hitsPerPage=3");
    assert.match(urls.b0rk, /search_by_date\?query=jvns\.ca&tags=story&hitsPerPage=\d+$/);
    assert.match(urls.danluu, /search_by_date\?query=danluu\.com&tags=story&hitsPerPage=\d+$/);
  });
});

describe("parseFollowInput", () => {
  it("riconosce utenti HN in più forme", () => {
    assert.deepEqual(parseFollowInput("pg"), { id: "hn:pg", kind: "hn_user", query: "pg" });
    assert.deepEqual(parseFollowInput(" @patio11 "), { id: "hn:patio11", kind: "hn_user", query: "patio11" });
    assert.equal(parseFollowInput("https://news.ycombinator.com/user?id=tptacek")?.id, "hn:tptacek");
  });
  it("riconosce domini e URL", () => {
    assert.deepEqual(parseFollowInput("jvns.ca"), { id: "domain:jvns.ca", kind: "domain", query: "jvns.ca" });
    assert.equal(parseFollowInput("https://www.Danluu.com/some/post")?.id, "domain:danluu.com");
    assert.equal(parseFollowInput("blog.example.co.uk")?.kind, "domain");
  });
  it("rifiuta input non validi o pericolosi", () => {
    for (const bad of ["", "a", "x".repeat(16), "foo bar", "user&tags=evil", "http://", "a.b", "<script>"]) {
      assert.equal(parseFollowInput(bad), null, bad);
    }
  });
  it("riporta un preset al suo autore completo", () => {
    const a = authorFromSpec({ id: "hn:antirez", kind: "hn_user", query: "antirez" });
    assert.equal(a.name, "Salvatore Sanfilippo");
    assert.equal(a.preset, true);
    assert.equal(authorFromSpec({ id: "hn:pg", kind: "hn_user", query: "pg" }).preset, false);
  });
});

describe("normalizzazione hit", () => {
  it("articolo con link esterno", () => {
    const s = normalizeStoryHit(
      { objectID: "1", title: "Redis 8 is out", url: "https://antirez.com/news/1", points: 321, num_comments: 88, created_at: hoursAgo(5), _tags: ["story", "author_antirez"] },
      "hn:antirez",
    );
    assert.ok(s);
    assert.equal(s.kind, "story");
    assert.equal(s.url, "https://antirez.com/news/1");
    assert.equal(s.discussionUrl, "https://news.ycombinator.com/item?id=1");
    assert.equal(s.points, 321);
    assert.deepEqual(s.abstract.facts.map((f) => f.label), ["Fonte", "Punti", "Commenti"]);
    assert.equal(s.abstract.kicker, "Articolo");
    assert.ok(s.abstract.topics.includes("Databases"));
  });

  it("Ask HN senza link punta alla discussione e usa il testo come abstract", () => {
    const s = normalizeStoryHit(
      { objectID: "2", title: "Ask HN: Is Redis still relevant?", url: null, points: 10, num_comments: 4, created_at: hoursAgo(1), story_text: "<p>First &amp; foremost.</p><p>Second point here.</p><p>Third.</p><p>Fourth.</p>", _tags: ["story", "ask_hn"] },
      "hn:x",
    );
    assert.ok(s);
    assert.equal(s.url, "https://news.ycombinator.com/item?id=2");
    assert.equal(s.abstract.kicker, "Ask HN");
    assert.equal(s.abstract.lead, "First & foremost.");
    assert.deepEqual(s.abstract.bullets, ["Second point here.", "Third."]);
  });

  it("commento = pensiero, con titolo della discussione e link al commento", () => {
    const s = normalizeStoryHit(
      { objectID: "99", comment_text: "<p>I think <i>simplicity</i> wins.</p>", story_id: 7, story_title: "Why Redis is simple", story_url: "https://example.com/redis", created_at: hoursAgo(2), _tags: ["comment", "author_antirez", "story_7"] },
      "hn:antirez",
    );
    assert.ok(s);
    assert.equal(s.kind, "comment");
    assert.equal(s.title, "Why Redis is simple");
    assert.equal(s.url, "https://example.com/redis");
    assert.equal(s.discussionUrl, "https://news.ycombinator.com/item?id=99");
    assert.equal(s.abstract.lead, "I think simplicity wins.");
  });

  it("scarta hit incompleti", () => {
    assert.equal(normalizeStoryHit({ objectID: "3" }, "a"), null);
    assert.equal(normalizeStoryHit({ title: "x", created_at: hoursAgo(1) }, "a"), null);
    assert.equal(normalizeStoryHit({ objectID: "4", created_at: hoursAgo(1), _tags: ["comment"] }, "a"), null);
  });
});

describe("selectStories", () => {
  const dom = { id: "domain:jvns.ca", kind: "domain" as const, query: "jvns.ca" };
  const hit = (id: string, url: string | null, h: number) => ({ objectID: id, title: `T${id}`, url, points: 1, num_comments: 0, created_at: hoursAgo(h), _tags: ["story"] });

  it("per i domini tiene solo link del sito, dal più recente, max 3", () => {
    const out = selectStories(dom, [
      hit("1", "https://jvns.ca/blog/a", 50),
      hit("2", "https://example.com/mentions-jvns.ca", 1),
      hit("3", "https://evil-jvns.ca.example.com/x", 2),
      hit("4", "https://jvns.ca/blog/b", 10),
      hit("5", "https://www.jvns.ca/blog/c", 30),
      hit("6", "https://jvns.ca/blog/d", 90),
      "garbage",
      null,
    ]);
    assert.deepEqual(out.map((s) => s.id), ["story-4", "story-5", "story-1"]);
  });

  it("per gli utenti non filtra per dominio", () => {
    const user = { id: "hn:pg", kind: "hn_user" as const, query: "pg" };
    assert.equal(selectStories(user, [hit("1", "https://a.com", 1), hit("2", null, 2)]).length, 2);
  });
});

describe("stato non letto (72 ore)", () => {
  const story = (id: string, h: number) => normalizeStoryHit({ objectID: id, title: id, created_at: hoursAgo(h), _tags: ["story"] }, "a")!;
  it("storia recente non vista → non letto", () => {
    assert.equal(hasUnread([story("1", 10)], new Set(), NOW), true);
  });
  it("storia vista → letto", () => {
    assert.equal(hasUnread([story("1", 10)], new Set(["story-1"]), NOW), false);
  });
  it("storia più vecchia di 72h non conta come nuova", () => {
    assert.equal(hasUnread([story("1", 73)], new Set(), NOW), false);
    assert.equal(hasUnread([story("1", UNREAD_WINDOW_MS / 3_600_000 - 0.01)], new Set(), NOW), true);
  });
  it("basta una storia nuova tra tante viste", () => {
    assert.equal(hasUnread([story("1", 5), story("2", 6)], new Set(["story-1"]), NOW), true);
  });
  it("ordine cronologico e indice di partenza", () => {
    const ordered = chronological([story("a", 1), story("b", 30), story("c", 10)]);
    assert.deepEqual(ordered.map((s) => s.id), ["story-b", "story-c", "story-a"]);
    assert.equal(startIndex(ordered, new Set()), 0);
    assert.equal(startIndex(ordered, new Set(["story-b"])), 1);
    assert.equal(startIndex(ordered, new Set(ordered.map((s) => s.id))), 0);
  });
});
