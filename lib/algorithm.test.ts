import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TechPost } from "../types/feed.ts";
import {
  DIMENSIONS,
  DIMENSION_COUNT,
  applyInteraction,
  applyOverride,
  badgeDimension,
  cosineSimilarity,
  norm,
  rankFeed,
  uniformVector,
  vectorizePost,
  type PostVector,
} from "./algorithm.ts";

const NOW = Date.parse("2026-11-09T12:00:00Z");
let seq = 0;

function post(title: string, extra: Partial<TechPost> = {}): TechPost {
  seq += 1;
  return {
    id: `t-${seq}`,
    title,
    url: `https://example.com/${seq}`,
    source: "hacker_news",
    author: "tester",
    points: 100,
    commentsCount: 20,
    publishedAt: new Date(NOW - 3 * 3_600_000).toISOString(),
    isArchive: false,
    tags: [],
    ...extra,
  };
}

const dimOf = (p: TechPost) => DIMENSIONS[vectorizePost(p).topIndex];
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe("vettorizzazione", () => {
  it("produce sempre vettori a 12 dimensioni di lunghezza unitaria", () => {
    for (const t of ["Postgres vacuum internals", "Hello world", "", "Rust kernel LLM React Docker"]) {
      const { vector } = vectorizePost(post(t));
      assert.equal(vector.length, DIMENSION_COUNT);
      close(norm(vector), 1);
    }
  });

  it("assegna la dimensione dominante corretta", () => {
    assert.equal(dimOf(post("PostgreSQL 17 improves vacuum and B-tree indexes")), "Databases");
    assert.equal(dimOf(post("A tiny Rust kernel with its own allocator")), "Systems_LowLevel");
    assert.equal(dimOf(post("Fine-tuning an LLM with PyTorch")), "AI_ML");
    assert.equal(dimOf(post("Why React re-renders: a CSS and browser deep dive")), "Web_Frontend");
    assert.equal(dimOf(post("Critical RCE vulnerability and exploit in OpenSSL")), "Security_Crypto");
    assert.equal(dimOf(post("Writing a parser and type checker for a small compiler")), "Compilers_PL");
    assert.equal(dimOf(post("Kubernetes and Terraform for CI/CD pipelines")), "DevOps_Infra");
    assert.equal(dimOf(post("Dynamic programming and graph algorithms explained")), "Math_Algorithms");
    assert.equal(dimOf(post("Soldering an FPGA board with an ESP32 microcontroller")), "Hardware_Embedded");
    assert.equal(dimOf(post("Burnout and career lessons learned")), "Career_Philosophy");
    assert.equal(dimOf(post("The GPL, license changes and the future of free software")), "OpenSource_Culture");
    assert.equal(dimOf(post("Sharding and consensus in distributed microservices")), "Backend_Scale");
  });

  it("usa tag e dominio come indizi", () => {
    assert.equal(dimOf(post("Interesting read", { tags: ["osdev"] })), "Systems_LowLevel");
    assert.equal(dimOf(post("Interesting read", { url: "https://www.sqlite.org/whynot.html" })), "Databases");
  });

  it("non confonde sigle ambigue (Go vs verbo, Rust come parola intera)", () => {
    assert.equal(vectorizePost(post("Let's go and see")).confidence, 0);
    assert.equal(vectorizePost(post("Trustworthy rusty gadgets")).confidence, 0);
  });

  it("post senza segnale → vettore neutro con confidenza 0", () => {
    const pv = vectorizePost(post("Hello"));
    assert.equal(pv.confidence, 0);
    for (const x of pv.vector) close(x, 1 / Math.sqrt(12));
  });
});

describe("user vector", () => {
  const u0 = uniformVector();
  const v = vectorizePost(post("Postgres vacuum and B-tree indexes")).vector;

  it("parte bilanciato e di lunghezza unitaria", () => {
    close(norm(u0), 1);
    assert.equal(u0.length, 12);
  });

  it("like / bookmark / skip seguono U ← Normalize(U + w·V)", () => {
    for (const [kind, w] of [["like", 0.2], ["bookmark", 0.25], ["read", 0.25], ["skip", -0.15]] as const) {
      const expectedRaw = u0.map((x, i) => x + w * v[i]);
      const n = Math.hypot(...expectedRaw);
      const out = applyInteraction(u0, v, kind);
      close(norm(out), 1);
      out.forEach((x, i) => close(x, expectedRaw[i] / n));
    }
  });

  it("i like aumentano l'affinità, gli skip la riducono", () => {
    const before = cosineSimilarity(u0, v);
    const liked = applyInteraction(applyInteraction(u0, v, "like"), v, "like");
    assert.ok(cosineSimilarity(liked, v) > before);
    const skipped = applyInteraction(u0, v, "skip");
    assert.ok(cosineSimilarity(skipped, v) < before);
  });

  it("l'override spinge una sola dimensione e mantiene la norma", () => {
    const up = applyOverride(u0, 0, 1);
    close(norm(up), 1);
    assert.ok(up[0] > u0[0] && up[1] < u0[1]);
    assert.ok(applyOverride(u0, 0, -1)[0] < u0[0]);
  });

  it("un vettore nullo ricade su quello uniforme", () => {
    const zero = new Array(12).fill(0);
    close(norm(applyInteraction(zero, zero, "like")), 1);
  });
});

describe("ranking epsilon-greedy", () => {
  const live: TechPost[] = [];
  const topics = ["Postgres vacuum", "Rust kernel", "LLM inference", "React hooks", "Kubernetes deploy", "Compiler parser"];
  for (let i = 0; i < 40; i++) {
    live.push(post(`${topics[i % topics.length]} number ${i}`, { points: 50 + i * 7, commentsCount: i }));
  }
  const archive: TechPost[] = Array.from({ length: 6 }, (_, i) =>
    post(`Classic ${topics[i]} essay`, { isArchive: true, points: 900 + i, publishedAt: "2019-05-01T00:00:00Z" }),
  );
  const all = [...live, ...archive];
  const vectors = new Map<string, PostVector>(all.map((p) => [p.id, vectorizePost(p)]));
  const user = applyOverride(applyOverride(uniformVector(), 4, 1), 4, 1); // spinge Databases

  it("è deterministico e non perde né duplica post live", () => {
    const a = rankFeed(all, vectors, user, { epsilon: 0.15, now: NOW });
    const b = rankFeed(all, vectors, user, { epsilon: 0.15, now: NOW });
    assert.deepEqual(a.map((r) => r.post.id), b.map((r) => r.post.id));
    const ids = a.map((r) => r.post.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(a.filter((r) => !r.post.isArchive).length, live.length);
  });

  it("inietta explore con cadenza regolare (5-7 post) e alterna frontier/archivio", () => {
    const ranked = rankFeed(all, vectors, user, { epsilon: 0.15, now: NOW });
    const positions = ranked.flatMap((r, i) => (r.slot === "exploit" ? [] : [i]));
    assert.ok(positions.length >= 5, `attesi ≥5 explore, trovati ${positions.length}`);
    assert.equal(positions[0], 5); // 6° post
    for (let i = 1; i < positions.length; i++) {
      const gap = positions[i] - positions[i - 1];
      assert.ok(gap >= 5 && gap <= 7, `gap ${gap}`);
    }
    const slots = ranked.filter((r) => r.slot !== "exploit").map((r) => r.slot);
    assert.deepEqual(slots.slice(0, 4), ["frontier", "archive", "frontier", "archive"]);
    assert.ok(ranked.filter((r) => r.slot === "archive").every((r) => r.post.isArchive));
  });

  it("i post scoperta hanno bassa affinità rispetto agli exploit di testa", () => {
    const ranked = rankFeed(all, vectors, user, { epsilon: 0.15, now: NOW });
    const exploitTop = ranked.filter((r) => r.slot === "exploit").slice(0, 5);
    const frontier = ranked.filter((r) => r.slot === "frontier");
    const avg = (xs: { affinity: number }[]) => xs.reduce((s, x) => s + x.affinity, 0) / xs.length;
    assert.ok(avg(frontier) < avg(exploitTop));
  });

  it("l'exploit mette in testa i post più affini al profilo", () => {
    const ranked = rankFeed(all, vectors, user, { epsilon: 0.15, now: NOW });
    const dbTitles = ranked.slice(0, 5).filter((r) => r.post.title.startsWith("Postgres")).length;
    assert.ok(dbTitles >= 3, `solo ${dbTitles} post Databases nei primi 5`);
  });

  it("epsilon alto aumenta la quota explore; i valori fuori range vengono limitati", () => {
    const share = (eps: number) => {
      const r = rankFeed(all, vectors, user, { epsilon: eps, now: NOW });
      return r.filter((x) => x.slot !== "exploit").length / r.length;
    };
    assert.ok(share(0.5) > share(0.15) && share(0.15) > share(0.05));
    assert.deepEqual(
      rankFeed(all, vectors, user, { epsilon: 9, now: NOW }).map((r) => r.post.id),
      rankFeed(all, vectors, user, { epsilon: 0.5, now: NOW }).map((r) => r.post.id),
    );
  });

  it("senza archivio le scoperte frontier riempiono gli slot", () => {
    const ranked = rankFeed(live, vectors, user, { epsilon: 0.15, now: NOW });
    assert.ok(ranked.some((r) => r.slot === "frontier"));
    assert.ok(ranked.every((r) => r.slot !== "archive"));
  });

  it("il decay temporale penalizza i post vecchi a parità di resto", () => {
    // Fresco e vecchio hanno poco consenso, così la scoperta frontier non li consuma.
    const fresh = post("Postgres vacuum news", { points: 1, commentsCount: 0, publishedAt: new Date(NOW - 3_600_000).toISOString() });
    const stale = post("Postgres vacuum news", { points: 1, commentsCount: 0, publishedAt: new Date(NOW - 72 * 3_600_000).toISOString() });
    const fillers = Array.from({ length: 20 }, (_, i) => post(`Rust kernel item ${i}`, { points: 500 + i }));
    const set = [fresh, stale, ...fillers];
    const vs = new Map(set.map((p) => [p.id, vectorizePost(p)]));
    const ranked = rankFeed(set, vs, user, { epsilon: 0.05, now: NOW });
    const f = ranked.find((r) => r.post.id === fresh.id);
    const s = ranked.find((r) => r.post.id === stale.id);
    assert.ok(f && s && f.slot === "exploit" && s.slot === "exploit");
    assert.ok(f.score > s.score * 1.5, `fresh ${f.score} vs stale ${s.score}`);
    assert.ok(ranked.indexOf(f) < ranked.indexOf(s));
  });

  it("badgeDimension sceglie la sovrapposizione utente/post", () => {
    const pv = vectorizePost(post("Postgres vacuum and Rust kernel"));
    assert.equal(badgeDimension(applyOverride(uniformVector(), 4, 1), pv), "Databases");
    assert.equal(badgeDimension(applyOverride(uniformVector(), 0, 1), pv), "Systems_LowLevel");
  });
});
