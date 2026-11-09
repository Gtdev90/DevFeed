import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCommentsSummary, normalizeHnItem, normalizeLobstersStory, normalizeRedditThread, parsePostId } from "./thread-core.ts";

describe("parsePostId", () => {
  it("riconosce solo gli id generati dall'app", () => {
    assert.deepEqual(parsePostId("hn-42"), { source: "hacker_news", externalId: "42" });
    assert.deepEqual(parsePostId("lobsters-abc123"), { source: "lobsters", externalId: "abc123" });
    assert.deepEqual(parsePostId("reddit-1ab2c3"), { source: "reddit", externalId: "1ab2c3" });
  });
  it("rifiuta tentativi di path traversal e host arbitrari", () => {
    for (const bad of ["", "hn-", "hn-1/../../x", "hn-1?x=1", "lobsters-AB", "reddit-../etc", "http://evil", "hn-1234567890123", "x-1"]) {
      assert.equal(parsePostId(bad), null, bad);
    }
  });
});

describe("thread Hacker News", () => {
  const item = {
    id: 1, title: "Ask HN: Q?", url: null, text: "<p>Body &amp; more</p><p>Second</p>",
    children: [
      { id: 10, author: "alice", text: "<p>Top level <i>one</i></p>", points: 5, children: [
        { id: 11, author: "bob", text: "<p>Reply</p>", children: [{ id: 12, author: "deep", text: "too deep", children: [] }] },
      ] },
      { id: 20, author: "carol", text: null, children: [] },
      { id: 30, author: "dave", text: "[dead]", children: [] },
    ],
  };
  it("appiattisce commenti e testo del post, scartando vuoti e [dead]", () => {
    const t = normalizeHnItem(item, "1");
    assert.ok(t);
    assert.equal(t.discussionUrl, "https://news.ycombinator.com/item?id=1");
    assert.equal(t.articleUrl, undefined);
    assert.equal(t.selfText, "Body & more\n\nSecond");
    assert.deepEqual(t.comments.map((c) => [c.author, c.depth]), [["alice", 0], ["bob", 1], ["deep", 2]]);
    assert.equal(t.comments[0].text, "Top level one");
  });
  it("limita il numero di commenti", () => {
    const many = { id: 1, children: Array.from({ length: 200 }, (_, i) => ({ id: i, author: "a", text: `<p>c${i}</p>`, children: [] })) };
    assert.equal(normalizeHnItem(many, "1")?.comments.length, 40);
  });
  it("non lancia su input non valido", () => {
    assert.equal(normalizeHnItem(null, "1"), null);
    assert.equal(normalizeHnItem("x", "1"), null);
  });
});

describe("thread Lobsters e Reddit", () => {
  it("Lobsters: usa indent_level come profondità", () => {
    const t = normalizeLobstersStory({ url: "https://a.test/x", comments_url: "https://lobste.rs/s/abc/x", comments: [
      { short_id: "c1", score: 7, comment_plain: "first", indent_level: 1, commenting_user: "u1" },
      { short_id: "c2", score: 3, comment_plain: "second", indent_level: 2, commenting_user: { username: "u2" } },
      { short_id: "c3", score: 1, comment_plain: "too deep", indent_level: 9, commenting_user: "u3" },
    ] }, "abc");
    assert.ok(t);
    assert.equal(t.articleUrl, "https://a.test/x");
    assert.deepEqual(t.comments.map((c) => [c.author, c.depth, c.score]), [["u1", 0, 7], ["u2", 1, 3]]);
  });
  it("Reddit: salta 'more', [deleted] e i link interni di reddit", () => {
    const listing = (children: unknown[]) => ({ data: { children } });
    const json = [
      listing([{ data: { url: "https://i.redd.it/x.png", is_self: false, permalink: "/r/p/comments/z/t/", selftext: "", title: "T" } }]),
      listing([
        { kind: "t1", data: { id: "a", author: "ann", body: "hello", score: 9, replies: listing([{ kind: "t1", data: { id: "b", author: "ben", body: "reply", score: 2, replies: "" } }]) } },
        { kind: "t1", data: { id: "c", author: "x", body: "[deleted]", score: 1, replies: "" } },
        { kind: "more", data: { id: "m" } },
      ]),
    ];
    const t = normalizeRedditThread(json, "z");
    assert.ok(t);
    assert.equal(t.articleUrl, undefined);
    assert.equal(t.discussionUrl, "https://www.reddit.com/r/p/comments/z/t/");
    assert.deepEqual(t.comments.map((c) => [c.author, c.depth]), [["ann", 0], ["ben", 1]]);
    const ext = normalizeRedditThread([listing([{ data: { url: "https://blog.example/p", is_self: false, permalink: "/r/p/comments/z/t/" } }]), listing([])], "z");
    assert.equal(ext?.articleUrl, "https://blog.example/p");
  });
  it("buildCommentsSummary privilegia i top-level e rispetta il limite", () => {
    const comments = [
      { id: "1", author: "b", text: "reply", depth: 1, score: 1 },
      { id: "2", author: "a", text: "top", depth: 0, score: 5 },
    ];
    assert.equal(buildCommentsSummary(comments), "a (5): top\n↳ b (1): reply");
    assert.ok(buildCommentsSummary(Array.from({ length: 50 }, (_, i) => ({ id: String(i), author: "u", text: "x".repeat(400), depth: 0 })), 1000).length <= 1000);
  });
});
