"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Lang } from "@/lib/ai/lang";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from "@/lib/prefs-store";

interface PrefsContextValue extends Omit<Prefs, "version"> {
  /** true dopo la lettura da IndexedDB. */
  loaded: boolean;
  setLang: (lang: Lang) => void;
  setTranslateTitles: (value: boolean) => void;
}

const PrefsContext = createContext<PrefsContextValue>({
  lang: DEFAULT_PREFS.lang,
  translateTitles: DEFAULT_PREFS.translateTitles,
  loaded: false,
  setLang: () => {},
  setTranslateTitles: () => {},
});

/** Fornisce lingua e preferenze di traduzione a tutta l'app, persistendole in IndexedDB. */
export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadPrefs().then((p) => {
      if (cancelled) return;
      setPrefs(p);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded) void savePrefs(prefs);
  }, [prefs, loaded]);

  const setLang = useCallback((lang: Lang) => setPrefs((p) => ({ ...p, lang })), []);
  const setTranslateTitles = useCallback((translateTitles: boolean) => setPrefs((p) => ({ ...p, translateTitles })), []);

  const value = useMemo<PrefsContextValue>(
    () => ({ lang: prefs.lang, translateTitles: prefs.translateTitles, loaded, setLang, setTranslateTitles }),
    [prefs.lang, prefs.translateTitles, loaded, setLang, setTranslateTitles],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);
