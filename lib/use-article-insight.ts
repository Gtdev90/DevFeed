import { useCallback, useEffect, useRef, useState } from "react";
import type { TechPost } from "@/types/feed";
import type { AnalyzeResponse } from "@/types/ai";
import type { ThreadContext } from "@/types/context";
import type { Lang } from "./ai/lang";
import {
  deleteCachedAnalysis,
  getCachedAnalysis,
  getCachedContext,
  setCachedAnalysis,
  setCachedContext,
} from "./ai-cache";

export interface InsightView {
  analysis: AnalyzeResponse | null;
  analysisStatus: "loading" | "ready" | "error";
  /** true se la sintesi arriva dalla cache locale (zero latenza, zero token). */
  fromCache: boolean;
  analysisError: string | null;
  context: ThreadContext | null;
  contextStatus: "idle" | "loading" | "ready" | "error";
  contextError: string | null;
}

const INITIAL: InsightView = {
  analysis: null,
  analysisStatus: "loading",
  fromCache: false,
  analysisError: null,
  context: null,
  contextStatus: "idle",
  contextError: null,
};

interface Stored extends InsightView {
  /** Chiave (post, lingua, rigenerazione) a cui si riferisce lo stato: se non coincide, si è in caricamento. */
  key: string;
}

const isAnalyzeResponse = (v: unknown): v is AnalyzeResponse =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as AnalyzeResponse).analysis === "object" &&
  Array.isArray((v as AnalyzeResponse).analysis?.threePillars) &&
  ((v as AnalyzeResponse).mode === "ai" || (v as AnalyzeResponse).mode === "fallback");

/**
 * Sintesi AI + contesto (articolo e commenti) di un post.
 *
 * Ordine delle operazioni: 1) cache IndexedDB `cache_${postId}_${lang}` → se presente la
 * sintesi è mostrata subito e NON parte alcuna richiesta; 2) altrimenti si carica il
 * contesto, si chiama `/api/ai/analyze` e il risultato AI viene salvato in cache.
 * I risultati di fallback non si cachano: configurando la chiave si passa all'AI.
 */
export function useArticleInsight(post: TechPost, lang: Lang) {
  const [nonce, setNonce] = useState(0);
  const key = `${post.id}|${lang}|${nonce}`;
  const [stored, setStored] = useState<Stored>({ ...INITIAL, key });
  const contextPromise = useRef<Promise<ThreadContext | null> | null>(null);

  const patch = useCallback((forKey: string, change: Partial<InsightView>) => {
    setStored((s) => ({ ...(s.key === forKey ? s : { ...INITIAL, key: forKey, context: s.context, contextStatus: s.contextStatus }), ...change, key: forKey }));
  }, []);

  /** Carica (una sola volta) articolo e commenti; condivide la richiesta tra sintesi e scheda "Originale". */
  const loadContext = useCallback((): Promise<ThreadContext | null> => {
    if (contextPromise.current) return contextPromise.current;
    const forKey = key;
    patch(forKey, { contextStatus: "loading", contextError: null });
    const promise = (async () => {
      const cached = await getCachedContext(post.id);
      if (cached) {
        patch(forKey, { context: cached, contextStatus: "ready" });
        return cached;
      }
      try {
        const res = await fetch(`/api/context?id=${encodeURIComponent(post.id)}`);
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok || typeof data !== "object" || data === null) {
          const message = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
          throw new Error(message);
        }
        const context = data as ThreadContext;
        void setCachedContext(post.id, context);
        patch(forKey, { context, contextStatus: "ready" });
        return context;
      } catch (err) {
        contextPromise.current = null; // permette di riprovare
        patch(forKey, { contextStatus: "error", contextError: err instanceof Error ? err.message : "Errore di rete" });
        return null;
      }
    })();
    contextPromise.current = promise;
    return promise;
  }, [key, patch, post.id]);

  useEffect(() => {
    const controller = new AbortController();
    const forKey = key;

    void (async () => {
      // 1) Cache locale: risposta istantanea, nessuna rete. Dopo "Rigenera" (nonce > 0) si salta.
      if (nonce === 0) {
        const cached = await getCachedAnalysis(post.id, lang);
        if (controller.signal.aborted) return;
        if (cached) {
          patch(forKey, {
            analysis: { analysis: cached.analysis, mode: "ai", lang, translated: true, model: cached.model },
            analysisStatus: "ready",
            fromCache: true,
          });
          return;
        }
      }

      // 2) Cache miss: contesto + analisi.
      const context = await loadContext();
      if (controller.signal.aborted) return;
      try {
        const res = await fetch("/api/ai/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            title: post.title,
            url: post.url,
            rawContent: context?.article?.text ?? post.rawContent ?? post.summarySnippet ?? "",
            commentsSummary: context?.commentsSummary ?? "",
            targetLang: lang,
            ...(nonce > 0 ? { regenerate: true } : {}),
          }),
        });
        const data: unknown = await res.json().catch(() => null);
        if (res.status === 429) throw new Error("Troppe richieste: attendi qualche secondo e riprova.");
        if (!res.ok || !isAnalyzeResponse(data)) {
          throw new Error((data as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
        }
        if (controller.signal.aborted) return;
        if (data.mode === "ai") void setCachedAnalysis(post.id, lang, data.analysis, data.model ?? "");
        patch(forKey, { analysis: data, analysisStatus: "ready", fromCache: false });
      } catch (err) {
        if (controller.signal.aborted) return;
        patch(forKey, {
          analysisStatus: "error",
          analysisError: err instanceof Error ? err.message : "Errore di rete",
        });
      }
    })();

    return () => controller.abort();
  }, [key, nonce, post.id, post.title, post.url, post.rawContent, post.summarySnippet, lang, loadContext, patch]);

  const regenerate = useCallback(async () => {
    await deleteCachedAnalysis(post.id, lang);
    setNonce((n) => n + 1);
  }, [post.id, lang]);

  const view: InsightView = stored.key === key ? stored : { ...INITIAL, context: stored.context, contextStatus: stored.contextStatus };
  return { ...view, loadContext, regenerate };
}
