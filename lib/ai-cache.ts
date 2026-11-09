import { del, get, getMany, set, setMany } from "idb-keyval";
import type { Analysis } from "@/types/ai";
import type { ThreadContext } from "@/types/context";
import type { Lang } from "./ai/lang";
import { parseAnalysis } from "./ai/parse";

/** Chiave della sintesi in IndexedDB: `cache_${postId}_${targetLang}`. */
export const analysisKey = (postId: string, lang: Lang) => `cache_${postId}_${lang}`;
export const titleKey = (postId: string, lang: Lang) => `title_${postId}_${lang}`;
export const contextKey = (postId: string) => `ctx_${postId}`;

const ANALYSIS_TTL_MS = 30 * 24 * 3_600_000;
const CONTEXT_TTL_MS = 6 * 3_600_000;

export interface CachedAnalysis {
  version: 1;
  analysis: Analysis;
  model: string;
  lang: Lang;
  savedAt: number;
}

const isFresh = (savedAt: unknown, ttl: number) => typeof savedAt === "number" && Date.now() - savedAt < ttl;

// Ogni accesso allo storage è protetto: in modalità privata o con storage bloccato la cache
// semplicemente non c'è, ma l'app continua a funzionare.

export async function getCachedAnalysis(postId: string, lang: Lang): Promise<CachedAnalysis | null> {
  try {
    const raw = await get<unknown>(analysisKey(postId, lang));
    if (typeof raw !== "object" || raw === null) return null;
    const entry = raw as Partial<CachedAnalysis>;
    if (entry.version !== 1 || entry.lang !== lang || !isFresh(entry.savedAt, ANALYSIS_TTL_MS)) return null;
    // Rivalida: un record corrotto o di una versione vecchia non deve rompere il drawer.
    const analysis = parseAnalysis(entry.analysis);
    return { version: 1, analysis, model: typeof entry.model === "string" ? entry.model : "", lang, savedAt: entry.savedAt as number };
  } catch {
    return null;
  }
}

export async function setCachedAnalysis(postId: string, lang: Lang, analysis: Analysis, model: string): Promise<void> {
  try {
    const entry: CachedAnalysis = { version: 1, analysis, model, lang, savedAt: Date.now() };
    await set(analysisKey(postId, lang), entry);
  } catch {
    /* cache non disponibile */
  }
}

export async function deleteCachedAnalysis(postId: string, lang: Lang): Promise<void> {
  try {
    await del(analysisKey(postId, lang));
  } catch {
    /* niente da fare */
  }
}

export async function getCachedContext(postId: string): Promise<ThreadContext | null> {
  try {
    const raw = await get<{ savedAt?: number; context?: ThreadContext }>(contextKey(postId));
    if (!raw || !isFresh(raw.savedAt, CONTEXT_TTL_MS) || raw.context?.postId !== postId) return null;
    return raw.context;
  } catch {
    return null;
  }
}

export async function setCachedContext(postId: string, context: ThreadContext): Promise<void> {
  try {
    await set(contextKey(postId), { savedAt: Date.now(), context });
  } catch {
    /* cache non disponibile */
  }
}

/** Titoli già tradotti per l'elenco di id (solo quelli presenti in cache). */
export async function getCachedTitles(ids: readonly string[], lang: Lang): Promise<Record<string, string>> {
  try {
    const values = await getMany<unknown>(ids.map((id) => titleKey(id, lang)));
    const out: Record<string, string> = {};
    ids.forEach((id, i) => {
      const v = values[i];
      if (typeof v === "string" && v) out[id] = v;
    });
    return out;
  } catch {
    return {};
  }
}

export async function setCachedTitles(translations: Record<string, string>, lang: Lang): Promise<void> {
  try {
    await setMany(Object.entries(translations).map(([id, title]) => [titleKey(id, lang), title]));
  } catch {
    /* cache non disponibile */
  }
}
