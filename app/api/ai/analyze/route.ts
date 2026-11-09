import { connection } from "next/server";
import type { NextRequest } from "next/server";
import type { Analysis, AnalyzeResponse } from "@/types/ai";
import { AI_FAILED_NOTICE, MISSING_KEY_NOTICE, buildFallbackAnalysis } from "@/lib/ai/fallback";
import { hasApiKey, runAnalysis } from "@/lib/ai/openrouter";
import { validateAnalyzeRequest } from "@/lib/ai/request";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

const MAX_BODY_BYTES = 200_000;

function fallbackResponse(
  analysis: Analysis,
  lang: AnalyzeResponse["lang"],
  notice: AnalyzeResponse["notice"],
): Response {
  const body: AnalyzeResponse = { analysis, mode: "fallback", lang, translated: false, notice };
  return Response.json(body);
}

/**
 * POST /api/ai/analyze
 * Body: { title, url, rawContent, commentsSummary, targetLang = "it" }
 *
 * Genera con OpenRouter la sintesi tecnica strutturata. Non risponde mai 5xx per problemi
 * dell'AI: senza OPENROUTER_API_KEY, o se i modelli falliscono, restituisce un'analisi di
 * fallback estratta euristicamente dal testo originale insieme a un avviso (`notice`).
 */
export async function POST(request: NextRequest): Promise<Response> {
  await connection();

  const limit = checkRateLimit(`analyze:${clientKey(request.headers)}`, 20, 60_000);
  if (!limit.ok) {
    return Response.json(
      { error: "Troppe richieste: riprova tra poco." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return Response.json({ error: "Payload troppo grande." }, { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON non valido." }, { status: 400 });
  }
  const parsed = validateAnalyzeRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const req = parsed.value;

  const fallback = () => buildFallbackAnalysis(req);
  if (!hasApiKey()) return fallbackResponse(fallback(), req.targetLang, MISSING_KEY_NOTICE);

  try {
    const { analysis, model } = await runAnalysis(
      req.title,
      req.url,
      req.rawContent,
      req.commentsSummary,
      req.targetLang,
      req.regenerate ? String(Date.now()) : "",
    );
    const response: AnalyzeResponse = { analysis, mode: "ai", lang: req.targetLang, translated: true, model };
    return Response.json(response);
  } catch {
    // Dettagli già registrati lato server; al client solo un avviso generico.
    return fallbackResponse(fallback(), req.targetLang, AI_FAILED_NOTICE);
  }
}
