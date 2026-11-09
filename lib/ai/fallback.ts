import type { Analysis, AnalyzeNotice } from "../../types/ai.ts";
import { snippet } from "../sources/parse.ts";

/** Segnali che rendono una frase tecnicamente informativa (numeri, meccanismi, trade-off). */
const SIGNAL =
  /\b(latency|throughput|memory|cache|thread|lock|index|query|compiler|kernel|protocol|api|algorithm|complexity|trade-?off|because|instead|however|faster|slower|bytes?|benchmark|database|performance|scal\w+|distributed|consensus|encrypt\w*|vulnerab\w+|architecture|implementation|overhead)\b|\bO\([^)]+\)|\b\d+(\.\d+)?\s?(ms|µs|ns|s|kb|mb|gb|%|x|k|m)\b/gi;

function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(\[])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 40 && s.length <= 320);
}

function score(sentence: string): number {
  const hits = sentence.match(SIGNAL)?.length ?? 0;
  const digits = (sentence.match(/\d/g) ?? []).length;
  return hits * 2 + Math.min(digits, 6) * 0.4 + Math.min(sentence.length, 220) / 220;
}

/** Primo blocco di codice nel testo (fence ``` o riga che "sembra" codice). */
function findCode(text: string): string | undefined {
  const fenced = text.match(/```\n?([\s\S]*?)```/);
  if (fenced?.[1]?.trim()) return snippet(fenced[1].trim(), 600);
  const line = text.split("\n").find((l) => /(\w+\([^)]*\)\s*[{;:]|=>|::|#include|\bfn\b|\bfunc\b|\bdef\b)/.test(l) && l.length < 200);
  return line?.trim();
}

/**
 * Analisi di emergenza estratta euristicamente dal testo originale, senza AI.
 * Non traduce: il titolo e i punti restano nella lingua della fonte.
 */
export function buildFallbackAnalysis(input: {
  title: string;
  rawContent: string;
  commentsSummary: string;
}): Analysis {
  const body = input.rawContent.trim();
  const all = sentences(body);

  const hookSentences = all.slice(0, 2);
  const hook =
    hookSentences.length > 0
      ? hookSentences.join(" ")
      : `${input.title}. Il testo completo non è disponibile: apri la fonte originale per i dettagli.`;

  const used = new Set(hookSentences);
  const ranked = all
    .map((s, i) => ({ s, i, v: score(s) }))
    .filter((x) => !used.has(x.s))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);

  const code = findCode(body);
  const concept = code ?? (ranked.length > 3 ? ranked[3] : "") ?? "";

  const commentLines = input.commentsSummary
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 30)
    .slice(0, 3)
    .map((l) => snippet(l, 260));

  return {
    translatedTitle: input.title,
    hook,
    threePillars: ranked,
    keySnippetOrConcept: concept,
    communityConsensus: commentLines.join("\n\n"),
  };
}

export const MISSING_KEY_NOTICE: AnalyzeNotice = {
  code: "missing_key",
  message:
    "Sintesi AI non attiva: imposta OPENROUTER_API_KEY nel file .env.local per ottenere traduzione e analisi complete. Questa è un'estrazione automatica dal testo originale.",
};

export const AI_FAILED_NOTICE: AnalyzeNotice = {
  code: "ai_failed",
  message:
    "Il servizio AI non ha risposto (chiave non valida, credito esaurito o servizio non disponibile). Mostro un'estrazione automatica dal testo originale.",
};
