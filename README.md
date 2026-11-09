# PULSE.DEV

Aggregatore di notizie tech con design system dark **Obsidian Terminal**.
Fase 1: foundation, design system e ingestion reale. Fase 2: motore vettoriale a 12 dimensioni e ranking epsilon-greedy. Fase 3: Tech Stories e doppia modalità di lettura (Deck / Stream). Fase 4: sintesi AI tradotte con OpenRouter, drawer di lettura in-app e schema Supabase.

## Avvio

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # test unitari (node:test)
npm run test:schema   # esegue supabase/schema.sql su un Postgres reale (PGlite + pgvector)
```

Serve accesso di rete in uscita verso `hn.algolia.com`, `lobste.rs` e `www.reddit.com`.

## Architettura

| Percorso | Ruolo |
| --- | --- |
| `types/feed.ts` | Tipi unificati (`SourceType`, `TechPost`, `FeedResponse`) |
| `lib/sources/*` | Una fonte per file: normalizzatore puro + fetcher con `'use cache'` (5 min live, 24 h archivio) |
| `lib/feed.ts` | Aggrega le fonti con `Promise.allSettled`: una fonte che cade non blocca le altre |
| `app/api/feed/route.ts` | `GET /api/feed` → `FeedResponse` (502 solo se **tutte** le fonti falliscono) |
| `components/*` | UI: card, badge, status delle fonti, lista animata con GSAP |

### Fonti

- **Hacker News (live)** — `front_page`, 25 post
- **Hacker News (archivio)** — oltre 700 punti, prima del 2022, 10 post, `isArchive: true`
- **Lobsters** — `hottest.json`
- **Reddit** — `r/programming/hot.json`, con `User-Agent: PulseDevApp/1.0` (senza, Reddit risponde 429)

Gli errori di una fonte non vengono messi in cache e sono riportati in `sources` nella risposta.

## Design tokens

Definiti in `app/globals.css` (`@theme`): `obsidian` `#050507`, `obsidian-card` `#0C0C10`,
bordo `rgba(255,255,255,.08)`, accenti `emerald-cyber` `#10B981`, `indigo-pulse` `#6366F1`,
`amber-glow` `#F59E0B`. Font: Geist (testi), JetBrains Mono (metadati e tag), serviti localmente.

## Motore di raccomandazione (Fase 2)

| Percorso | Ruolo |
| --- | --- |
| `lib/algorithm.ts` | Tassonomia a 12 dimensioni, vettorizzazione euristica, coseno, update dello user vector, ranking epsilon-greedy. Puro e deterministico (niente `Math.random`) |
| `lib/algorithm.test.ts` | Test: norma unitaria, regole di update, cadenza dell'explore, decay, determinismo |
| `lib/profile-store.ts` | Persistenza del profilo in IndexedDB (`idb-keyval`), scritture serializzate |
| `lib/use-taste-profile.ts` | Hook React: carica il profilo, applica le interazioni, salva a ogni modifica |
| `components/feed-experience.tsx` | Orchestra ranking, azioni, animazioni GSAP (ingresso + Flip) |
| `components/vector-radar.tsx` | Pannello Live Vector Radar (sidebar desktop, drawer mobile) |

**Vettorizzazione.** Ogni post riceve un vettore a 12 componenti, `‖V‖ = 1`, sommando i pesi delle keyword
trovate in titolo, tag, URL e snippet (più indizi su tag Lobsters e domini noti), smorzati con `log1p`.
Senza alcun segnale il vettore è neutro e la card mostra "Generalista" invece di una percentuale inventata.

**Profilo.** `U` parte uniforme (`1/√12` per componente). Like `+0.20·V`, bookmark e lettura `+0.25·V`,
skip `−0.15·V`, sempre seguiti da normalizzazione. Ogni interazione vale una volta per post.

**Ranking.** Exploit: `cos(U,V) × (0.55+0.45·community) × (0.45+0.55·decay) × affidabilità`, con community
= `log(punti + ½·commenti)` relativo alla fonte e decay con emivita di 12 h. Explore: ogni ≈ `1/ε` post
(6°, 13°, 20°… con ε = 15%) si alternano una *scoperta fuori bolla* (bassa affinità, alto consenso) e una
*perla d'archivio*; se una categoria finisce si usa l'altra.

**Aggiornamenti.** Le percentuali di Match e il radar cambiano subito a ogni azione. L'ordine delle card
cambia solo con "Ricalcola Feed" o quando si muove lo slider ε / si usa un override (+/−), con
riposizionamento GSAP Flip.

## Tech Stories e modalità Deck / Stream (Fase 3)

| Percorso | Ruolo |
| --- | --- |
| `app/api/stories/route.ts` | `GET /api/stories[?follow=a,b][&presets=0]`: storie degli autori (Algolia `search_by_date`) |
| `lib/stories-core.ts` | Parte pura e testata: preset, parsing degli handle, normalizzazione, regola 72 h |
| `lib/stories.ts` | Fetch con cache di 10 min per autore, `Promise.allSettled` |
| `lib/stories-store.ts` | `viewedStoryIds` e autori seguiti in IndexedDB |
| `components/stories-bar.tsx`, `story-ring.tsx` | Carosello con anello GSAP (ciano→indaco, pulsante se non letto) e "+ Segui" |
| `components/story-viewer.tsx` | Viewer a schermo intero: timeline 8 s, tap & hold, tap 30/70, swipe con `Observer` |
| `components/feed-experience.tsx` | Modalità Deck (Observer, drag elastico) e Stream, con passaggio via GSAP Flip |

**Storie.** Una "storia" è un post *o un commento* dell'autore su Hacker News (gli URL `author_*` restituiscono
entrambi). Per i siti (jvns.ca, danluu.com) si scaricano 20 hit e si tengono solo i link che puntano davvero al
dominio. L'anello pulsa solo se c'è almeno una storia non vista nelle ultime 72 ore. Si può seguire qualsiasi
username HN (`tptacek`) o sito (`paulgraham.com`); la scelta è salvata in IndexedDB.

**Deck.** Una card per schermata: rotella, trascinamento (con rotazione e scala elastiche), tasti ↑ ↓ o pulsanti.
Soglia di 60 px, una sola card per gesto. Esc o ✕ per tornare allo Stream.

## AI, traduzione e produzione (Fase 4)

Copia `.env.example` in `.env.local` e imposta `OPENROUTER_API_KEY`. **Senza chiave l'app funziona comunque**:
le sintesi diventano un'estrazione automatica dal testo originale (senza traduzione) con un avviso discreto,
e la traduzione dei titoli del feed risulta "non disponibile".

| Percorso | Ruolo |
| --- | --- |
| `app/api/ai/analyze/route.ts` | `POST` → sintesi strutturata (`translatedTitle`, `hook`, `threePillars`, `keySnippetOrConcept`, `communityConsensus`). Mai 5xx per problemi AI: risponde 200 con `mode: "fallback"` e un `notice` |
| `app/api/ai/titles/route.ts` | `POST` → traduce fino a 40 titoli per richiesta |
| `app/api/context/route.ts` | `GET ?id=<postId>` → articolo sorgente e commenti (HN, Lobsters, Reddit) |
| `lib/ai/*` | Prompt, glossario dei termini tecnici, parsing/validazione dell'output, fallback euristico, client OpenRouter |
| `lib/net/safe-fetch.ts`, `article.ts` | Download anti-SSRF dell'articolo ed estrazione del testo |
| `lib/ai-cache.ts` | Cache IndexedDB: `cache_${postId}_${lang}` (30 giorni), `title_…`, `ctx_…` (6 h) |
| `components/article-drawer.tsx` | Drawer a tutto schermo (GSAP) con toggle Sintesi ⇄ Originale (fade + blur) |
| `components/settings-menu.tsx` | Lingua (it/en/es/fr/de) e traduzione dei titoli; persistite in IndexedDB |
| `supabase/schema.sql` | Schema Postgres + pgvector, con `match_posts()` per la similarità coseno e RLS |

**Modelli.** Principale `google/gemini-2.5-flash`, riserva `deepseek/deepseek-chat` (sovrascrivibili con
`OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODEL`). Si passa al secondo su errore, timeout o JSON non valido;
con 401/402/403 ci si ferma subito (un altro modello non cambierebbe nulla).

**Cache a tre livelli.** (1) IndexedDB nel browser: se la sintesi esiste, si mostra senza alcuna richiesta.
(2) `'use cache'` lato server (24 h) sulla chiamata al modello, condivisa tra utenti. (3) Gli errori non vengono
mai messi in cache. Le sintesi di fallback non si cachano, così configurando la chiave si passa all'AI.
"Rigenera" salta entrambe le cache.

**Termini tecnici.** Il prompt elenca i termini da non tradurre (pointer, goroutine, garbage collection, race
condition, deadlock, zero-copy…). In più, `restoreTechnicalTerms` ripristina a posteriori quelli che il modello
traduce comunque ("condizione di gara", "raccolta dei rifiuti", "puntatore"…), ma solo se il termine inglese è
davvero presente nella fonte.

**Sicurezza.**
- *SSRF*: l'URL dell'articolo lo decide chi sottomette il post, quindi si scarica con un resolver che rifiuta
  indirizzi privati/loopback/link-local (anche IPv6 e IPv4-mapped), porte non standard, credenziali nell'URL,
  redirect rivalidati (max 3), timeout 8 s e tetto di 1,5 MB. `/api/context` accetta solo un `id` e contatta host
  fissi; l'URL non arriva mai dal client.
- *Prompt injection*: il testo di articoli e commenti è delimitato nel prompt e dichiarato non fidato; l'output
  viene validato (schema, lunghezze) e reso solo come testo.
- *Costi*: rate limit in memoria (20 analisi/min, 12 lotti di titoli/min per IP), payload e contesto limitati.
  In un deploy multi-istanza va affiancato da un limite a monte.

**Supabase.** `supabase/schema.sql` è idempotente: incollalo nello SQL Editor o copialo in
`supabase/migrations/`. Le scritture su `posts`, `authors`, `author_posts` e `article_summaries` sono riservate
alla `service_role`; `user_profiles` è accessibile solo al proprietario.
