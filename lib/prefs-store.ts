import { get, set } from "idb-keyval";
import { DEFAULT_LANG, isLang, type Lang } from "./ai/lang";

const PREFS_KEY = "pulse:prefs:v1";

/** Impostazioni dell'app persistite in IndexedDB. */
export interface Prefs {
  version: 1;
  /** Lingua dei riassunti e dei titoli tradotti. */
  lang: Lang;
  /** true = il feed mostra i titoli tradotti. */
  translateTitles: boolean;
}

export const DEFAULT_PREFS: Prefs = { version: 1, lang: DEFAULT_LANG, translateTitles: false };

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await Promise.race([
      get<unknown>(PREFS_KEY),
      new Promise<undefined>((resolve) => setTimeout(resolve, 1500)),
    ]);
    if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
    const p = raw as Partial<Prefs>;
    return {
      version: 1,
      lang: isLang(p.lang) ? p.lang : DEFAULT_LANG,
      translateTitles: p.translateTitles === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  try {
    await set(PREFS_KEY, prefs);
  } catch {
    /* storage non disponibile */
  }
}
