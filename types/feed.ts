/** Piattaforme da cui PULSE.DEV aggrega i contenuti. */
export type SourceType = "hacker_news" | "lobsters" | "reddit" | "author_rss";

/** Post tecnico normalizzato, indipendente dalla piattaforma di origine. */
export interface TechPost {
  /** Identificativo univoco globale, nel formato `<prefisso-fonte>-<id-originale>`. */
  id: string;
  title: string;
  /** URL dell'articolo (o della discussione, per i post senza link esterno). */
  url: string;
  source: SourceType;
  author: string;
  points: number;
  commentsCount: number;
  /** Data di pubblicazione in formato ISO 8601 (UTC). */
  publishedAt: string;
  /** true se il post ha più di 2 anni ed è una "pietra miliare" dell'archivio. */
  isArchive: boolean;
  /** Estratto testuale del contenuto, quando la fonte lo fornisce. */
  summarySnippet?: string;
  /** Contenuto grezzo, quando la fonte lo fornisce. */
  rawContent?: string;
  tags: string[];
}

/** Esito del recupero di una singola fonte. */
export type SourceId = "hn_front_page" | "hn_archive" | "lobsters" | "reddit";

export type SourceStatus =
  | { id: SourceId; label: string; ok: true; count: number }
  | { id: SourceId; label: string; ok: false; error: string };

/** Payload restituito da `GET /api/feed`. */
export interface FeedResponse {
  posts: TechPost[];
  sources: SourceStatus[];
  /** Istante (ISO 8601) in cui la risposta è stata composta. */
  fetchedAt: string;
}
