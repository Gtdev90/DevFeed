# PULSE.DEV

Aggregatore di notizie tech con design system dark **Obsidian Terminal**.
Fase 1: foundation, design system e ingestion reale. Fase 2: motore vettoriale a 12 dimensioni e ranking epsilon-greedy.

## Avvio

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # test dell'algoritmo (node:test)
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
