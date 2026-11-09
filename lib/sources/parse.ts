/**
 * Helper di parsing difensivo: le API esterne restituiscono JSON non tipizzato,
 * quindi ogni campo viene validato a runtime prima di entrare in `TechPost`.
 */

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v !== "")
    : [];
}

/** Converte un timestamp in secondi Unix in stringa ISO 8601. */
export function isoFromUnixSeconds(seconds: number | undefined): string | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString();
}

/** Normalizza una stringa data in ISO 8601; `undefined` se non valida. */
export function toIso(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** Hostname "pulito" di un URL (senza `www.`), `undefined` se l'URL non è valido. */
export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Rimuove i tag HTML e collassa gli spazi, per ricavare uno snippet testuale. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/** Spezza l'HTML di HN (paragrafi `<p>`) in paragrafi di testo semplice. */
export function htmlToParagraphs(html: string): string[] {
  return html
    .split(/<p>|<\/p>|<br\s*\/?>/i)
    .map((part) => stripHtml(part))
    .filter((part) => part !== "");
}

export function snippet(text: string, max = 280): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Errore con il codice HTTP, per diagnosticare i fallimenti delle singole fonti. */
export class SourceError extends Error {
  readonly source: string;

  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
    this.name = "SourceError";
    this.source = source;
  }
}

const FETCH_TIMEOUT_MS = 10_000;

/** GET JSON con timeout; lancia `SourceError` se la risposta non è 2xx o non è JSON. */
export async function fetchJson(
  source: string,
  url: string | URL,
  headers: Record<string, string> = {},
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // Node nasconde la causa di rete (ECONNREFUSED, timeout, ...) in `err.cause`.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    const reason = cause ?? (err instanceof Error ? err.message : String(err));
    throw new SourceError(source, `richiesta fallita (${reason})`);
  }
  if (!res.ok) {
    throw new SourceError(source, `HTTP ${res.status} ${res.statusText}`.trim());
  }
  try {
    return await res.json();
  } catch {
    throw new SourceError(source, "risposta non è JSON valido");
  }
}
