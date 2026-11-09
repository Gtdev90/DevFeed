import { cacheLife } from "next/cache";
import type { Analysis } from "@/types/ai";
import { restoreTechnicalTerms } from "./glossary";
import type { Lang } from "./lang";
import { extractJson, parseAnalysis, parseTitleMap } from "./parse";
import { analysisSystemPrompt, analysisUserPrompt, titlesSystemPrompt, titlesUserPrompt } from "./prompt";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "google/gemini-2.5-flash";
export const DEFAULT_FALLBACK_MODEL = "deepseek/deepseek-chat";
const REQUEST_TIMEOUT_MS = 60_000;

export function hasApiKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

/** Modello principale e di riserva (sovrascrivibili da env), senza duplicati. */
export function configuredModels(): string[] {
  const primary = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  const secondary = process.env.OPENROUTER_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
  return primary === secondary ? [primary] : [primary, secondary];
}

class AiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

async function chat(model: string, system: string, user: string, maxTokens: number): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new AiError("OPENROUTER_API_KEY mancante");

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Intestazioni di attribuzione consigliate da OpenRouter.
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL?.trim() || "http://localhost:3000",
        "X-Title": "PULSE.DEV",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AiError(`${model}: richiesta fallita (${err instanceof Error ? err.message : "errore di rete"})`);
  }
  // Il corpo dell'errore non viene propagato: potrebbe contenere dettagli dell'account.
  if (!res.ok) throw new AiError(`${model}: HTTP ${res.status}`, res.status);

  const data: unknown = await res.json().catch(() => null);
  const content =
    typeof data === "object" && data !== null
      ? ((data as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content ?? null)
      : null;
  if (typeof content !== "string" || !content.trim()) throw new AiError(`${model}: risposta vuota`);
  return content;
}

/** Prova i modelli in sequenza: passa al successivo su errore, timeout o JSON non valido. */
async function withFallbackModels<T>(run: (model: string) => Promise<T>): Promise<{ value: T; model: string }> {
  const failures: string[] = [];
  for (const model of configuredModels()) {
    try {
      return { value: await run(model), model };
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
      // Chiave non valida o credito finito: un secondo modello non cambierebbe nulla.
      if (err instanceof AiError && (err.status === 401 || err.status === 402 || err.status === 403)) break;
    }
  }
  console.warn(`[ai] tutti i modelli hanno fallito: ${failures.join(" | ")}`);
  throw new AiError(failures.join(" | "));
}

/**
 * Analisi AI di un post. Il risultato è in cache lato server (24 h) per evitare di pagare
 * due volte lo stesso input; gli errori lanciano e quindi non vengono mai messi in cache.
 */
export async function runAnalysis(
  title: string,
  url: string,
  rawContent: string,
  commentsSummary: string,
  lang: Lang,
  /** Fa parte della chiave di cache: un valore nuovo ("Rigenera") forza una nuova generazione. */
  variant = "",
): Promise<{ analysis: Analysis; model: string }> {
  "use cache";
  void variant;
  cacheLife({ stale: 300, revalidate: 86_400, expire: 604_800 });

  const system = analysisSystemPrompt(lang);
  const user = analysisUserPrompt({ title, url, rawContent, commentsSummary });
  const { value, model } = await withFallbackModels(async (m) =>
    parseAnalysis(extractJson(await chat(m, system, user, 1600))),
  );

  const source = `${title}\n${rawContent}\n${commentsSummary}`;
  const fix = (text: string) => restoreTechnicalTerms(text, source, lang);
  return {
    model,
    analysis: {
      translatedTitle: fix(value.translatedTitle),
      hook: fix(value.hook),
      threePillars: value.threePillars.map(fix),
      keySnippetOrConcept: fix(value.keySnippetOrConcept),
      communityConsensus: fix(value.communityConsensus),
    },
  };
}

/** Traduce un lotto di titoli. Le chiavi inviate al modello sono indici opachi, non gli id dei post. */
export async function translateTitles(
  lang: Lang,
  items: { id: string; title: string }[],
): Promise<{ translations: Record<string, string>; model: string }> {
  const keyed = items.map((item, i) => ({ key: String(i), id: item.id, title: item.title }));
  const system = titlesSystemPrompt(lang);
  const user = titlesUserPrompt(keyed);
  const { value, model } = await withFallbackModels(async (m) =>
    parseTitleMap(extractJson(await chat(m, system, user, 2400)), keyed.map((k) => k.key)),
  );

  const translations: Record<string, string> = {};
  for (const k of keyed) {
    const t = value[k.key];
    if (t) translations[k.id] = restoreTechnicalTerms(t, k.title, lang);
  }
  return { translations, model };
}
