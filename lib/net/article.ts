import type { ArticleContent } from "../../types/context.ts";
import { snippet } from "../sources/parse.ts";

const MAX_TEXT = 14_000;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", laquo: "«", raquo: "»", middot: "·", times: "×",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

const textOf = (html: string) =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

function codeOf(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""))
    .replace(/\r/g, "")
    .replace(/^\n+|\s+$/g, "");
}

function meta(html: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const tag = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${name}["'][^>]*>`, "i").exec(html)?.[0];
    const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content && content.trim()) return decodeEntities(content).trim();
  }
  return undefined;
}

const NOISE = /<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button|select|dialog)\b[\s\S]*?<\/\1>/gi;

/** Sceglie il contenitore principale: `<article>` più lungo, altrimenti `<main>`, altrimenti `<body>`. */
function mainContainer(html: string): string {
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((m) => m[1]);
  const longest = articles.sort((a, b) => b.length - a.length)[0];
  if (longest && textOf(longest).length > 400) return longest;
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1];
  if (main && textOf(main).length > 400) return main;
  return /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
}

/**
 * Estrae titolo, autore e testo leggibile da una pagina HTML con euristiche leggere
 * (nessuna dipendenza DOM). Restituisce `null` se non c'è testo utile.
 */
export function extractArticle(html: string, url: string): ArticleContent | null {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, "").replace(NOISE, " ");
  const container = mainContainer(cleaned);

  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const m of container.matchAll(/<(h[1-3]|p|li|pre|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = m[1].toLowerCase();
    let block: string;
    if (tag === "pre") {
      const code = codeOf(m[2]);
      if (code.length < 8) continue;
      block = `\`\`\`\n${code}\n\`\`\``;
    } else {
      const t = textOf(m[2]);
      if (tag.startsWith("h") ? t.length < 3 : t.length < 40) continue;
      block = tag.startsWith("h") ? `## ${t}` : t;
    }
    if (seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
  }

  const joined = blocks.join("\n\n");
  if (joined.replace(/```|##/g, "").trim().length < 120) return null;

  const truncated = joined.length > MAX_TEXT;
  const text = truncated ? `${joined.slice(0, MAX_TEXT).trimEnd()}…` : joined;
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];

  return {
    url,
    title: meta(html, "og:title", "twitter:title") ?? (titleTag ? textOf(titleTag) : undefined),
    siteName: meta(html, "og:site_name"),
    byline: meta(html, "author", "article:author"),
    description: meta(html, "og:description", "description")
      ? snippet(meta(html, "og:description", "description") ?? "", 300)
      : undefined,
    text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    truncated,
  };
}
