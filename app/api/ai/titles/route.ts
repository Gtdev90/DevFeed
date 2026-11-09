import { connection } from "next/server";
import type { NextRequest } from "next/server";
import type { TitlesResponse } from "@/types/ai";
import { AI_FAILED_NOTICE, MISSING_KEY_NOTICE } from "@/lib/ai/fallback";
import { hasApiKey, translateTitles } from "@/lib/ai/openrouter";
import { validateTitlesRequest } from "@/lib/ai/request";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

/**
 * POST /api/ai/titles
 * Body: { lang, items: [{ id, title }] } (max 40). Traduce i titoli del feed.
 * Senza chiave o in caso di errore risponde 200 con `mode: "unavailable"`: i titoli
 * restano nella lingua originale e l'app continua a funzionare.
 */
export async function POST(request: NextRequest): Promise<Response> {
  await connection();

  const limit = checkRateLimit(`titles:${clientKey(request.headers)}`, 12, 60_000);
  if (!limit.ok) {
    return Response.json(
      { error: "Troppe richieste: riprova tra poco." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON non valido." }, { status: 400 });
  }
  const parsed = validateTitlesRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  if (!hasApiKey()) {
    const out: TitlesResponse = { translations: {}, mode: "unavailable", notice: MISSING_KEY_NOTICE };
    return Response.json(out);
  }
  try {
    const { translations } = await translateTitles(parsed.value.lang, parsed.value.items);
    const out: TitlesResponse = { translations, mode: "ai" };
    return Response.json(out);
  } catch {
    const out: TitlesResponse = { translations: {}, mode: "unavailable", notice: AI_FAILED_NOTICE };
    return Response.json(out);
  }
}
