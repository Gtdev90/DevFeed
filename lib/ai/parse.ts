import type { Analysis } from "../../types/ai.ts";

const MAX = { title: 300, hook: 900, pillar: 700, concept: 2200, consensus: 1800 } as const;

/** Estrae il primo oggetto JSON da un testo, tollerando fence markdown e testo attorno. */
export function extractJson(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("risposta senza JSON");
    return JSON.parse(stripped.slice(start, end + 1));
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+\n/g, "\n").trim();
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Valida l'output del modello: il JSON deve rispettare lo schema richiesto. Lancia se manca
 * un campo essenziale, così il chiamante può passare al modello successivo.
 */
export function parseAnalysis(raw: unknown): Analysis {
  if (!isRecord(raw)) throw new Error("la risposta non è un oggetto");
  const translatedTitle = text(raw.translatedTitle, MAX.title);
  const hook = text(raw.hook, MAX.hook);
  const pillars = Array.isArray(raw.threePillars)
    ? raw.threePillars.flatMap((p) => {
        const t = text(p, MAX.pillar);
        return t ? [t] : [];
      })
    : [];
  if (!translatedTitle) throw new Error("translatedTitle mancante");
  if (!hook) throw new Error("hook mancante");
  if (pillars.length === 0) throw new Error("threePillars mancante");

  return {
    translatedTitle,
    hook,
    threePillars: pillars.slice(0, 3),
    keySnippetOrConcept: text(raw.keySnippetOrConcept, MAX.concept) ?? "",
    communityConsensus: text(raw.communityConsensus, MAX.consensus) ?? "",
  };
}

/**
 * Valida la mappa di titoli tradotti: tiene solo le chiavi richieste, con stringhe sensate.
 * Le chiavi sconosciute (iniettate dal contenuto) vengono scartate.
 */
export function parseTitleMap(raw: unknown, allowedKeys: readonly string[]): Record<string, string> {
  const source = isRecord(raw) && isRecord(raw.translations) ? raw.translations : raw;
  if (!isRecord(source)) throw new Error("la risposta non è un oggetto");
  const out: Record<string, string> = {};
  for (const key of allowedKeys) {
    const t = text(source[key], MAX.title);
    if (t) out[key] = t;
  }
  if (Object.keys(out).length === 0) throw new Error("nessuna traduzione valida");
  return out;
}
