/** Tipo di fonte seguibile: un utente Hacker News o un sito/blog (dominio). */
export type AuthorKind = "hn_user" | "domain";

/** Identifica una fonte da seguire. `id` è `hn:<username>` oppure `domain:<host>`. */
export interface FollowSpec {
  id: string;
  kind: AuthorKind;
  /** Username HN (case-sensitive) oppure dominio in minuscolo. */
  query: string;
}

export interface StoryAuthor extends FollowSpec {
  /** Nome da mostrare sotto l'avatar. */
  name: string;
  /** Handle pubblico (es. "antirez", "jvns.ca"). */
  handle: string;
  /** true per gli autori preimpostati, false per quelli seguiti dall'utente. */
  preset: boolean;
  /** Avatar remoto opzionale; in caso di errore si usa il monogramma. */
  avatarUrl?: string;
}

export interface StoryAbstract {
  /** Etichetta del tipo di contenuto (es. "Articolo", "Commento su HN"). */
  kicker: string;
  /** Frase d'apertura estratta dal testo, se disponibile. */
  lead?: string;
  /** Ulteriori punti estratti dal testo (max 2). */
  bullets: string[];
  /** Dati di contesto strutturati. */
  facts: { label: string; value: string }[];
  /** Temi rilevati dal motore vettoriale (etichette brevi). */
  topics: string[];
}

export interface Story {
  id: string;
  authorId: string;
  /** "story" = post sottomesso a HN; "comment" = pensiero scritto in una discussione. */
  kind: "story" | "comment";
  title: string;
  /** Link all'articolo (o alla discussione se non c'è un link esterno). */
  url: string;
  /** Link alla pagina HN della storia o del commento. */
  discussionUrl: string;
  publishedAt: string;
  points: number;
  commentsCount: number;
  abstract: StoryAbstract;
}

export interface AuthorStories {
  author: StoryAuthor;
  stories: Story[];
  /** Presente se il recupero di questo autore è fallito. */
  error?: string;
}

/** Payload di `GET /api/stories`. */
export interface StoriesResponse {
  authors: AuthorStories[];
  fetchedAt: string;
}
