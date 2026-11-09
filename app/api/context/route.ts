import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getThreadContext } from "@/lib/thread";
import { parsePostId } from "@/lib/thread-core";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

/**
 * GET /api/context?id=<postId>   (es. hn-12345, lobsters-abc123, reddit-1ab2c3)
 * Restituisce articolo sorgente e commenti del post. L'host da contattare dipende solo dal
 * prefisso dell'id e l'URL dell'articolo viene dall'API della piattaforma, mai dal client.
 * Risponde 502 solo se la discussione non è recuperabile.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await connection();

  const limit = checkRateLimit(`context:${clientKey(request.headers)}`, 40, 60_000);
  if (!limit.ok) {
    return Response.json(
      { error: "Troppe richieste: riprova tra poco." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!parsePostId(id)) return Response.json({ error: "`id` non valido." }, { status: 400 });

  try {
    const context = await getThreadContext(id);
    return context ? Response.json(context) : Response.json({ error: "`id` non valido." }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Discussione non recuperabile." },
      { status: 502 },
    );
  }
}
