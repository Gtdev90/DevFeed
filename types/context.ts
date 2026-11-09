/** Testo dell'articolo estratto dalla pagina sorgente. */
export interface ArticleContent {
  url: string;
  title?: string;
  siteName?: string;
  byline?: string;
  description?: string;
  /** Paragrafi separati da riga vuota; i blocchi di codice sono racchiusi tra ```. */
  text: string;
  wordCount: number;
  /** true se il testo è stato troncato al limite. */
  truncated: boolean;
}

export interface ThreadComment {
  id: string;
  author: string;
  text: string;
  score?: number;
  /** 0 = commento di primo livello. */
  depth: number;
}

/** Contesto di un post: articolo sorgente e discussione. */
export interface ThreadContext {
  postId: string;
  discussionUrl: string;
  article: ArticleContent | null;
  /** Motivo per cui l'articolo non è disponibile (se `article` è null). */
  articleError?: string;
  comments: ThreadComment[];
  /** Digest testuale dei commenti, pronto per il prompt. */
  commentsSummary: string;
  fetchedAt: string;
}
