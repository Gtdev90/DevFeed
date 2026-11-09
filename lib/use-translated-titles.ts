import { useEffect, useRef, useState } from "react";
import type { TechPost } from "@/types/feed";
import type { TitlesResponse } from "@/types/ai";
import type { Lang } from "./ai/lang";
import { getCachedTitles, setCachedTitles } from "./ai-cache";

export type TitlesStatus = "off" | "loading" | "ready" | "unavailable";

const CHUNK = 25;
const PARALLEL = 2;

interface Result {
  /** id del post → titolo tradotto. */
  titles: Record<string, string>;
  status: TitlesStatus;
  notice: string | null;
}

const OFF: Result = { titles: {}, status: "off", notice: null };

/**
 * Traduce i titoli del feed nella lingua scelta. Legge prima la cache IndexedDB
 * (`title_${postId}_${lang}`) e chiede al server solo i titoli mancanti, a lotti.
 * Senza chiave AI (o in caso di errore) i titoli restano originali e `status` è "unavailable".
 */
export function useTranslatedTitles(posts: readonly TechPost[], enabled: boolean, lang: Lang): Result {
  const [result, setResult] = useState<{ key: string } & Result>({ key: "", ...OFF });
  const requested = useRef(new Set<string>());
  /** Chiave per cui il servizio è risultato non disponibile: non si ritenta finché l'utente non spegne e riaccende. */
  const blocked = useRef<string | null>(null);
  const ids = posts.map((p) => p.id).join("|");
  const key = `${enabled}|${lang}`;

  useEffect(() => {
    if (!enabled) {
      blocked.current = null;
      return;
    }
    if (blocked.current === key) return;
    const controller = new AbortController();
    let mine: string[] = [];
    const requestedSet = requested.current;
    const merge = (change: Partial<Result>, titles?: Record<string, string>) =>
      setResult((r) => ({
        ...(r.key === key ? r : { key, ...OFF }),
        key,
        ...change,
        titles: titles ? { ...(r.key === key ? r.titles : {}), ...titles } : r.key === key ? r.titles : {},
      }));

    void (async () => {
      // Le fonti sono già in inglese: tradurre verso l'inglese costerebbe token senza dare nulla.
      if (lang === "en") {
        merge({ status: "ready", notice: "Le fonti sono già in inglese: nessuna traduzione necessaria." });
        return;
      }
      const cached = await getCachedTitles(posts.map((p) => p.id), lang);
      if (controller.signal.aborted) return;
      merge({ status: "loading", notice: null }, cached);

      const missing = posts.filter((p) => !cached[p.id] && !requestedSet.has(`${p.id}_${lang}`));
      if (missing.length === 0) {
        merge({ status: "ready" });
        return;
      }
      mine = missing.map((p) => `${p.id}_${lang}`);
      for (const k of mine) requestedSet.add(k);

      const chunks: TechPost[][] = [];
      for (let i = 0; i < missing.length; i += CHUNK) chunks.push(missing.slice(i, i + CHUNK));

      let unavailable: string | null = null;
      const worker = async () => {
        for (let chunk = chunks.shift(); chunk && !unavailable; chunk = chunks.shift()) {
          try {
            const res = await fetch("/api/ai/titles", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({ lang, items: chunk.map((p) => ({ id: p.id, title: p.title })) }),
            });
            const data = (await res.json().catch(() => null)) as TitlesResponse | { error?: string } | null;
            if (!res.ok || !data || !("mode" in data)) {
              unavailable = (data as { error?: string } | null)?.error ?? `Errore ${res.status}`;
              break;
            }
            if (data.mode === "unavailable") {
              unavailable = data.notice?.message ?? "Traduzione non disponibile.";
              break;
            }
            if (controller.signal.aborted) return;
            void setCachedTitles(data.translations, lang);
            merge({}, data.translations);
          } catch (err) {
            if (controller.signal.aborted) return;
            unavailable = err instanceof Error ? err.message : "Errore di rete";
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
      if (controller.signal.aborted) return;
      if (unavailable) blocked.current = key;
      merge(unavailable ? { status: "unavailable", notice: unavailable } : { status: "ready" });
    })();

    return () => {
      controller.abort();
      // Se il lotto è interrotto, i titoli non ancora tradotti devono poter essere ritentati;
      // quelli già arrivati sono in cache e non verranno richiesti di nuovo.
      for (const k of mine) requestedSet.delete(k);
    };
    // `ids` riassume l'elenco dei post: l'effetto riparte solo se cambia l'insieme visibile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lang, ids, key]);

  return enabled && result.key === key ? { titles: result.titles, status: result.status, notice: result.notice } : OFF;
}
