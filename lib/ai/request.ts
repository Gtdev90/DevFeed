import type { AnalyzeRequest } from "../../types/ai.ts";
import { DEFAULT_LANG, isLang, type Lang } from "./lang.ts";

const LIMITS = { title: 400, url: 2048, rawContent: 60_000, commentsSummary: 30_000 } as const;
export const MAX_TITLES_PER_REQUEST = 40;

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function optionalString(value: unknown, max: number, field: string): Validation<string> {
  if (value === undefined || value === null) return { ok: true, value: "" };
  if (typeof value !== "string") return { ok: false, error: `\`${field}\` deve essere una stringa.` };
  return { ok: true, value: value.length > max ? value.slice(0, max) : value };
}

/** Valida il payload di `/api/ai/analyze`. Il testo troppo lungo viene troncato, non rifiutato. */
export function validateAnalyzeRequest(body: unknown): Validation<AnalyzeRequest> {
  if (!isRecord(body)) return { ok: false, error: "Il corpo deve essere un oggetto JSON." };
  if (typeof body.title !== "string" || body.title.trim() === "") {
    return { ok: false, error: "`title` è obbligatorio." };
  }
  if (body.regenerate !== undefined && typeof body.regenerate !== "boolean") {
    return { ok: false, error: "`regenerate` deve essere un booleano." };
  }
  if (body.targetLang !== undefined && !isLang(body.targetLang)) {
    return { ok: false, error: "`targetLang` non supportata (it, en, es, fr, de)." };
  }

  const url = optionalString(body.url, LIMITS.url, "url");
  const raw = optionalString(body.rawContent, LIMITS.rawContent, "rawContent");
  const comments = optionalString(body.commentsSummary, LIMITS.commentsSummary, "commentsSummary");
  for (const v of [url, raw, comments]) if (!v.ok) return v;
  if (url.ok && url.value && !/^https?:\/\//i.test(url.value)) {
    return { ok: false, error: "`url` deve essere un indirizzo http(s)." };
  }

  return {
    ok: true,
    value: {
      title: body.title.trim().slice(0, LIMITS.title),
      url: url.ok ? url.value : "",
      rawContent: raw.ok ? raw.value : "",
      commentsSummary: comments.ok ? comments.value : "",
      targetLang: isLang(body.targetLang) ? body.targetLang : DEFAULT_LANG,
      ...(body.regenerate === true ? { regenerate: true } : {}),
    },
  };
}

export interface TitlesRequest {
  lang: Lang;
  items: { id: string; title: string }[];
}

/** Valida il payload di `/api/ai/titles`. */
export function validateTitlesRequest(body: unknown): Validation<TitlesRequest> {
  if (!isRecord(body)) return { ok: false, error: "Il corpo deve essere un oggetto JSON." };
  if (!isLang(body.lang)) return { ok: false, error: "`lang` non supportata (it, en, es, fr, de)." };
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { ok: false, error: "`items` deve essere un array non vuoto." };
  }
  if (body.items.length > MAX_TITLES_PER_REQUEST) {
    return { ok: false, error: `Massimo ${MAX_TITLES_PER_REQUEST} titoli per richiesta.` };
  }
  const items: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const item of body.items) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string") {
      return { ok: false, error: "Ogni elemento richiede `id` e `title` (stringhe)." };
    }
    if (item.id.length > 80 || seen.has(item.id)) return { ok: false, error: "`id` non valido o duplicato." };
    seen.add(item.id);
    if (item.title.trim()) items.push({ id: item.id, title: item.title.trim().slice(0, 300) });
  }
  if (items.length === 0) return { ok: false, error: "Nessun titolo da tradurre." };
  return { ok: true, value: { lang: body.lang, items } };
}
