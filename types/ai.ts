import type { Lang } from "@/lib/ai/lang";

/** Sintesi tecnica strutturata di un post. */
export interface Analysis {
  translatedTitle: string;
  /** Cos'è e perché è importante (2 frasi). */
  hook: string;
  /** Fino a 3 punti tecnici concreti (architettura, codice, tradeoff). */
  threePillars: string[];
  /** Spiegazione del pattern o dell'algoritmo centrale. */
  keySnippetOrConcept: string;
  /** Sintesi dei commenti più intelligenti / delle critiche emerse. */
  communityConsensus: string;
}

/** Payload di `POST /api/ai/analyze`. */
export interface AnalyzeRequest {
  title: string;
  url: string;
  rawContent: string;
  commentsSummary: string;
  targetLang: Lang;
  /** true = ignora anche la cache lato server e rigenera la sintesi (pulsante "Rigenera"). */
  regenerate?: boolean;
}

export interface AnalyzeNotice {
  /** `missing_key`: nessuna OPENROUTER_API_KEY; `ai_failed`: la chiamata AI è fallita. */
  code: "missing_key" | "ai_failed";
  message: string;
}

export interface AnalyzeResponse {
  analysis: Analysis;
  /** `ai` = generata dal modello; `fallback` = estratta euristicamente dal testo originale. */
  mode: "ai" | "fallback";
  lang: Lang;
  /** false se il testo non è stato tradotto (fallback): resta nella lingua originale. */
  translated: boolean;
  model?: string;
  notice?: AnalyzeNotice;
}

export interface TitlesResponse {
  /** id del post → titolo tradotto. */
  translations: Record<string, string>;
  mode: "ai" | "unavailable";
  notice?: AnalyzeNotice;
}
