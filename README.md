# PULSE.DEV

Aggregatore di notizie tech con design system dark **Obsidian Terminal**.
Fase 1: foundation, design system e ingestion reale da fonti pubbliche.

## Avvio

```bash
npm install
npm run dev      # http://localhost:3000
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
