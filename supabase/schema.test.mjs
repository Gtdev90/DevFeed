// Esegue supabase/schema.sql su un Postgres reale (PGlite + pgvector) con uno stub dell'ambiente Supabase
// (ruoli anon/authenticated/service_role, auth.users, auth.uid()). Uso: npm run test:schema

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const SCHEMA = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const db = new PGlite({ extensions: { vector } });
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const expectError = async (name, fn, re) => {
  try { await fn(); check(name, false, "nessun errore"); } catch (e) { check(name, re.test(String(e.message)), String(e.message).slice(0, 90)); }
};

// --- Stub dell'ambiente Supabase (in Supabase esistono già) ---
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);

// --- 1) applicazione e idempotenza ---
await db.exec(SCHEMA);
check("lo schema si applica senza errori", true);
await db.exec(SCHEMA);
check("lo schema è idempotente (seconda esecuzione senza errori)", true);

const tables = (await db.query("select table_name from information_schema.tables where table_schema='public' order by 1")).rows.map((r) => r.table_name);
check("tabelle attese presenti", ["article_summaries", "author_posts", "authors", "posts", "user_profiles"].every((t) => tables.includes(t)), tables.join(","));
const dim = (await db.query("select atttypmod as d from pg_attribute where attrelid='public.posts'::regclass and attname='embedding'")).rows[0].d;
check("posts.embedding è vector(12)", dim === 12, `typmod=${dim}`);
const dimU = (await db.query("select atttypmod as d from pg_attribute where attrelid='public.user_profiles'::regclass and attname='taste_vector'")).rows[0].d;
check("user_profiles.taste_vector è vector(12)", dimU === 12);
const idx = (await db.query("select indexdef from pg_indexes where schemaname='public' and indexname='posts_embedding_hnsw_idx'")).rows[0]?.indexdef ?? "";
check("indice HNSW con vector_cosine_ops", /hnsw/.test(idx) && /vector_cosine_ops/.test(idx));

// --- 2) dati e similarità coseno ---
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const unit = () => { const v = Array.from({ length: 12 }, () => rnd() - 0.2); const n = Math.hypot(...v); return v.map((x) => x / n); };
const vecs = [];
for (let i = 0; i < 60; i++) {
  const v = unit(); vecs.push(v);
  await db.query(
    "insert into public.posts (id, source, title, url, published_at, is_archive, embedding) values ($1,'hacker_news',$2,$3,now() - ($4 || ' days')::interval,$5,$6)",
    [`hn-${i}`, `Post ${i}`, `https://example.com/${i}`, String(i), i % 10 === 0, JSON.stringify(v)],
  );
}
const q = unit();
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const expected = vecs.map((v, i) => ({ id: `hn-${i}`, c: cos(q, v) })).sort((a, b) => b.c - a.c).slice(0, 10);
const got = (await db.query("select id, similarity from public.match_posts($1::vector, 10)", [JSON.stringify(q)])).rows;
check("match_posts: stesso ordine del coseno calcolato in JS (top 10)", JSON.stringify(got.map((r) => r.id)) === JSON.stringify(expected.map((r) => r.id)));
check("match_posts: similarity = cos(U,V)", got.every((r, i) => Math.abs(r.similarity - expected[i].c) < 1e-5), `max diff ${Math.max(...got.map((r, i) => Math.abs(r.similarity - expected[i].c))).toExponential(1)}`);
const arch = (await db.query("select count(*)::int n, bool_and(is_archive) all_arch from public.match_posts($1::vector, 50, 0.0, true)", [JSON.stringify(q)])).rows[0];
check("match_posts(only_archive=true) restituisce solo archivio", arch.n > 0 && arch.all_arch, `${arch.n} post`);
const minSim = (await db.query("select min(similarity) m from public.match_posts($1::vector, 60, 0.5)", [JSON.stringify(q)])).rows[0].m;
check("min_similarity filtra", minSim === null || minSim >= 0.5);
check("match_count è limitato a 200", (await db.query("select count(*)::int n from public.match_posts($1::vector, 100000)", [JSON.stringify(q)])).rows[0].n <= 200);

// --- 3) uso dell'indice HNSW ---
await db.exec("set enable_seqscan = off");
const plan = (await db.query("explain select id from public.posts order by embedding <=> $1::vector limit 10", [JSON.stringify(q)])).rows.map((r) => r["QUERY PLAN"]).join("\n");
check("ORDER BY embedding <=> $1 usa l'indice HNSW", /posts_embedding_hnsw_idx/.test(plan), plan.split("\n").find((l) => /Index/.test(l))?.trim());
await db.exec("reset enable_seqscan");

// --- 4) vincoli ---
await expectError("vector di dimensione sbagliata rifiutato", () => db.query("insert into public.posts (id,source,title,url,published_at,embedding) values ('x1','reddit','t','u',now(),'[1,2,3]')"), /dimensions/i);
await expectError("source non valida rifiutata", () => db.query("insert into public.posts (id,source,title,url,published_at) values ('x2','twitter','t','u',now())"), /check/i);
await expectError("punti negativi rifiutati", () => db.query("insert into public.posts (id,source,title,url,published_at,points) values ('x3','reddit','t','u',now(),-1)"), /check/i);
await db.query("insert into public.article_summaries (post_id, lang, model, analysis) values ('hn-1','it','m','{\"hook\":\"x\"}')");
await expectError("una sola sintesi per (post, lingua)", () => db.query("insert into public.article_summaries (post_id, lang, model, analysis) values ('hn-1','it','m','{}')"), /unique|duplicate/i);
await expectError("lingua non supportata rifiutata", () => db.query("insert into public.article_summaries (post_id, lang, model, analysis) values ('hn-1','xx','m','{}')"), /check/i);
await expectError("sintesi per un post inesistente rifiutata (FK)", () => db.query("insert into public.article_summaries (post_id, lang, model, analysis) values ('nope','it','m','{}')"), /foreign key/i);
await db.query("insert into public.authors (id, kind, query, name, handle, preset) values ('hn:antirez','hn_user','antirez','Salvatore Sanfilippo','antirez',true)");
await db.query("insert into public.author_posts (id, author_id, kind, title, url, discussion_url, published_at) values ('story-1','hn:antirez','comment','t','u','d',now())");
await db.query("delete from public.authors where id='hn:antirez'");
check("eliminando un autore si eliminano i suoi post (cascade)", (await db.query("select count(*)::int n from public.author_posts")).rows[0].n === 0);

// --- 5) trigger di creazione profilo + default ---
const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";
await db.query("insert into auth.users (id) values ($1), ($2)", [userA, userB]);
const prof = (await db.query("select taste_vector::text t, epsilon, preferred_lang from public.user_profiles where id=$1", [userA])).rows[0];
check("il profilo viene creato al signup", !!prof);
const tv = JSON.parse(prof.t);
check("taste_vector di default uniforme e unitario", tv.length === 12 && Math.abs(Math.hypot(...tv) - 1) < 1e-4, `‖U‖=${Math.hypot(...tv).toFixed(5)}`);
check("default epsilon 0.15 e lingua it", prof.epsilon === 0.15 && prof.preferred_lang === "it");
await expectError("epsilon fuori range rifiutato", () => db.query("update public.user_profiles set epsilon = 0.9 where id=$1", [userA]), /check/i);

// --- 6) RLS ---
const asUser = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
};
const asAnon = async (fn) => { await db.exec("set role anon;"); try { return await fn(); } finally { await db.exec("reset role;"); } };

await asUser(userA, async () => { await db.query("update public.user_profiles set taste_vector=$1::vector, hidden_post_ids=$2 where id=$3", [JSON.stringify(q), ["hn-0"], userA]); });
check("l'utente vede solo il proprio profilo", await asUser(userB, async () => (await db.query("select count(*)::int n from public.user_profiles")).rows[0].n === 1));
check("l'utente B non può modificare il profilo di A", await asUser(userB, async () => (await db.query("update public.user_profiles set epsilon=0.5 where id=$1 returning id", [userA])).rows.length === 0));
await asUser(userB, async () => expectError("l'utente B non può inserire un profilo per A", () => db.query("insert into public.user_profiles (id) values ($1)", [userA]), /row-level security|duplicate/i));
check("anon non vede alcun profilo", await asAnon(async () => (await db.query("select count(*)::int n from public.user_profiles")).rows[0].n === 0));
check("anon legge i post (lettura pubblica)", await asAnon(async () => (await db.query("select count(*)::int n from public.posts")).rows[0].n === 60));
await asAnon(() => expectError("anon non può scrivere post", () => db.query("insert into public.posts (id,source,title,url,published_at) values ('evil','reddit','t','u',now())"), /row-level security/i));
await asUser(userA, () => expectError("un utente autenticato non può scrivere post", () => db.query("insert into public.posts (id,source,title,url,published_at) values ('evil2','reddit','t','u',now())"), /row-level security/i));
check("anon legge le sintesi condivise", await asAnon(async () => (await db.query("select count(*)::int n from public.article_summaries")).rows[0].n === 1));
await asAnon(() => expectError("anon non può scrivere sintesi", () => db.query("insert into public.article_summaries (post_id, lang, model, analysis) values ('hn-2','it','m','{}')"), /row-level security/i));

// --- 7) match_posts_for_me ---
const mine = await asUser(userA, async () => (await db.query("select id, similarity from public.match_posts_for_me(10)")).rows);
const expectedMine = vecs.map((v, i) => ({ id: `hn-${i}`, c: cos(q, v) })).filter((x) => x.id !== "hn-0").sort((a, b) => b.c - a.c).slice(0, 10);
check("match_posts_for_me usa il taste_vector e salta i post nascosti", JSON.stringify(mine.map((r) => r.id)) === JSON.stringify(expectedMine.map((r) => r.id)) && !mine.some((r) => r.id === "hn-0"));
check("match_posts_for_me senza profilo/utente non restituisce nulla", await asAnon(async () => (await db.query("select count(*)::int n from public.match_posts_for_me(10)")).rows[0].n === 0));
await db.exec("set enable_seqscan = off");
const planMe = (await db.query("explain select p.id from public.posts p order by p.embedding <=> (select up.taste_vector from public.user_profiles up where up.id = '" + userA + "') limit 10")).rows.map((r) => r["QUERY PLAN"]).join("\n");
check("la forma di query di match_posts_for_me può usare l'indice HNSW", /posts_embedding_hnsw_idx/.test(planMe));

console.log(failures === 0 ? "\nTUTTO OK" : `\n${failures} VERIFICHE FALLITE`);
process.exit(failures === 0 ? 0 : 1);
