/** Lingue supportate per sintesi e traduzione dei titoli. */
export const LANGS = ["it", "en", "es", "fr", "de"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "it";

export const LANG_META: Record<Lang, { label: string; english: string }> = {
  it: { label: "Italiano", english: "Italian" },
  en: { label: "English", english: "English" },
  es: { label: "Español", english: "Spanish" },
  fr: { label: "Français", english: "French" },
  de: { label: "Deutsch", english: "German" },
};

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}
