-- ============================================================================
-- PULSE.DEV — schema Supabase (PostgreSQL + pgvector)
--
-- Come applicarlo:
--   • Supabase Dashboard → SQL Editor → incolla ed esegui, oppure
--   • supabase db push  (copiandolo in supabase/migrations/<timestamp>_init.sql)
--
-- Lo script è idempotente: si può rieseguire senza errori.
--
-- Spazio vettoriale: 12 dimensioni, nell'ordine di `DIMENSIONS` in lib/algorithm.ts
--   0 Systems_LowLevel   1 AI_ML               2 Web_Frontend     3 Backend_Scale
--   4 Databases          5 Security_Crypto     6 Compilers_PL     7 OpenSource_Culture
--   8 DevOps_Infra       9 Math_Algorithms    10 Hardware_Embedded 11 Career_Philosophy
-- I vettori dei post hanno lunghezza euclidea 1; la distanza coseno `<=>` di pgvector
-- è quindi 1 − cos(U, V). Un vettore NULLO non ha coseno definito: non va mai inserito.
-- ============================================================================

create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- Utilità
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- posts — feed aggregato (Hacker News, Lobsters, Reddit) + pietre miliari
-- ----------------------------------------------------------------------------
create table if not exists public.posts (
  id                   text primary key,                -- 'hn-123', 'lobsters-abc123', 'reddit-1ab2c3'
  source               text not null
                         check (source in ('hacker_news', 'lobsters', 'reddit', 'author_rss')),
  title                text not null,
  url                  text not null,
  author               text not null default 'unknown',
  points               integer not null default 0 check (points >= 0),
  comments_count       integer not null default 0 check (comments_count >= 0),
  published_at         timestamptz not null,
  is_archive           boolean not null default false,  -- pietra miliare (> 2 anni)
  summary_snippet      text,
  tags                 text[] not null default '{}',
  embedding            vector(12),                      -- ‖V‖ = 1, vedi lib/algorithm.ts
  embedding_confidence real check (embedding_confidence between 0 and 1),
  fetched_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists posts_published_at_idx on public.posts (published_at desc);
create index if not exists posts_source_idx       on public.posts (source, published_at desc);
create index if not exists posts_archive_idx      on public.posts (points desc) where is_archive;
create index if not exists posts_tags_idx         on public.posts using gin (tags);
-- Ricerca per similarità coseno: indice HNSW (pgvector ≥ 0.5). Gli ORDER BY embedding <=> $1
-- con LIMIT lo usano automaticamente.
create index if not exists posts_embedding_hnsw_idx
  on public.posts using hnsw (embedding vector_cosine_ops);

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- authors / author_posts — Tech Stories degli autori seguiti
-- ----------------------------------------------------------------------------
create table if not exists public.authors (
  id          text primary key,                        -- 'hn:antirez', 'domain:jvns.ca'
  kind        text not null check (kind in ('hn_user', 'domain')),
  query       text not null,                           -- username HN oppure dominio
  name        text not null,
  handle      text not null,
  preset      boolean not null default false,          -- autore preimpostato
  avatar_url  text,
  created_at  timestamptz not null default now(),
  unique (kind, query)
);

create table if not exists public.author_posts (
  id              text primary key,                    -- 'story-<objectID Algolia>'
  author_id       text not null references public.authors (id) on delete cascade,
  kind            text not null check (kind in ('story', 'comment')),
  title           text not null,
  url             text not null,
  discussion_url  text not null,
  published_at    timestamptz not null,
  points          integer not null default 0 check (points >= 0),
  comments_count  integer not null default 0 check (comments_count >= 0),
  abstract        jsonb not null default '{}'::jsonb,  -- StoryAbstract (kicker, lead, bullets, facts, topics)
  embedding       vector(12),
  fetched_at      timestamptz not null default now()
);

create index if not exists author_posts_author_idx
  on public.author_posts (author_id, published_at desc);
create index if not exists author_posts_embedding_hnsw_idx
  on public.author_posts using hnsw (embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- user_profiles — profilo di gusto dell'utente (uno per utente autenticato)
-- ----------------------------------------------------------------------------
create table if not exists public.user_profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  -- Default: vettore uniforme bilanciato, 1/√12 ≈ 0.288675 su ogni dimensione.
  taste_vector          vector(12) not null default
    '[0.288675,0.288675,0.288675,0.288675,0.288675,0.288675,0.288675,0.288675,0.288675,0.288675,0.288675,0.288675]',
  epsilon               real not null default 0.15 check (epsilon between 0.05 and 0.5),
  preferred_lang        text not null default 'it' check (preferred_lang in ('it', 'en', 'es', 'fr', 'de')),
  translate_titles      boolean not null default false,
  liked_post_ids        text[] not null default '{}',
  bookmarked_post_ids   text[] not null default '{}',
  read_post_ids         text[] not null default '{}',
  hidden_post_ids       text[] not null default '{}',
  followed_author_ids   text[] not null default '{}',
  viewed_story_ids      text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- article_summaries — sintesi AI condivise tra utenti (una per post e lingua)
-- ----------------------------------------------------------------------------
create table if not exists public.article_summaries (
  id          bigint generated always as identity primary key,
  post_id     text not null references public.posts (id) on delete cascade,
  lang        text not null check (lang in ('it', 'en', 'es', 'fr', 'de')),
  model       text not null,                           -- es. 'google/gemini-2.5-flash'
  analysis    jsonb not null,                          -- Analysis (translatedTitle, hook, threePillars, ...)
  created_at  timestamptz not null default now(),
  unique (post_id, lang)
);

create index if not exists article_summaries_post_idx on public.article_summaries (post_id);

-- ----------------------------------------------------------------------------
-- Ricerca per similarità coseno
-- ----------------------------------------------------------------------------

-- Post più affini a un vettore: similarity = 1 − distanza coseno = cos(U, V).
-- Con ORDER BY sulla distanza + LIMIT l'indice HNSW viene usato.
create or replace function public.match_posts(
  query_embedding vector(12),
  match_count     int     default 20,
  min_similarity  float   default 0.0,
  only_archive    boolean default null          -- null = tutti, true = solo archivio, false = solo live
)
returns table (
  id          text,
  source      text,
  title       text,
  url         text,
  is_archive  boolean,
  similarity  float
)
language sql
stable
as $$
  select p.id, p.source, p.title, p.url, p.is_archive,
         1 - (p.embedding <=> query_embedding) as similarity
  from public.posts p
  where p.embedding is not null
    and (only_archive is null or p.is_archive = only_archive)
    and 1 - (p.embedding <=> query_embedding) >= min_similarity
  order by p.embedding <=> query_embedding
  limit least(match_count, 200);
$$;

-- Come sopra, ma con il taste_vector dell'utente autenticato e senza i post nascosti.
-- Il vettore è letto con una subquery scalare (InitPlan): così il planner può usare l'indice
-- HNSW, cosa che non farebbe con un JOIN sul profilo.
create or replace function public.match_posts_for_me(
  match_count int default 20
)
returns table (
  id          text,
  title       text,
  url         text,
  is_archive  boolean,
  similarity  float
)
language sql
stable
security invoker                                  -- rispetta la RLS: legge solo il profilo di auth.uid()
as $$
  select p.id, p.title, p.url, p.is_archive,
         1 - (p.embedding <=> (select up.taste_vector from public.user_profiles up where up.id = auth.uid())) as similarity
  from public.posts p
  where p.embedding is not null
    and exists (select 1 from public.user_profiles up where up.id = auth.uid())   -- senza profilo: nessun risultato
    and not (p.id = any (coalesce(
          (select up.hidden_post_ids from public.user_profiles up where up.id = auth.uid()), '{}')))
  order by p.embedding <=> (select up.taste_vector from public.user_profiles up where up.id = auth.uid())
  limit least(match_count, 200);
$$;

-- ----------------------------------------------------------------------------
-- Row Level Security
--   • posts, authors, author_posts, article_summaries: lettura pubblica; le scritture
--     le fa solo il backend con la service_role key (che bypassa la RLS).
--   • user_profiles: ognuno vede e modifica solo il proprio profilo.
-- ----------------------------------------------------------------------------
alter table public.posts              enable row level security;
alter table public.authors            enable row level security;
alter table public.author_posts       enable row level security;
alter table public.article_summaries  enable row level security;
alter table public.user_profiles      enable row level security;

drop policy if exists "posts: lettura pubblica" on public.posts;
create policy "posts: lettura pubblica" on public.posts
  for select to anon, authenticated using (true);

drop policy if exists "authors: lettura pubblica" on public.authors;
create policy "authors: lettura pubblica" on public.authors
  for select to anon, authenticated using (true);

drop policy if exists "author_posts: lettura pubblica" on public.author_posts;
create policy "author_posts: lettura pubblica" on public.author_posts
  for select to anon, authenticated using (true);

drop policy if exists "article_summaries: lettura pubblica" on public.article_summaries;
create policy "article_summaries: lettura pubblica" on public.article_summaries
  for select to anon, authenticated using (true);

drop policy if exists "user_profiles: select proprio" on public.user_profiles;
create policy "user_profiles: select proprio" on public.user_profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "user_profiles: insert proprio" on public.user_profiles;
create policy "user_profiles: insert proprio" on public.user_profiles
  for insert to authenticated with check (id = (select auth.uid()));

drop policy if exists "user_profiles: update proprio" on public.user_profiles;
create policy "user_profiles: update proprio" on public.user_profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "user_profiles: delete proprio" on public.user_profiles;
create policy "user_profiles: delete proprio" on public.user_profiles
  for delete to authenticated using (id = (select auth.uid()));

-- Crea automaticamente il profilo al primo accesso di un utente.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
