import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getStories, presetSpecs } from "@/lib/stories";
import { MAX_FOLLOWED, parseFollowInput } from "@/lib/stories-core";
import type { FollowSpec } from "@/types/stories";

/**
 * GET /api/stories
 *   ?follow=<handle>,<handle>  utenti HN o domini da aggiungere (max 8)
 *   &presets=0                 esclude gli autori preimpostati (default: inclusi)
 *
 * Risponde 400 se un handle non è valido, 502 se nessun autore è stato recuperato.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const params = request.nextUrl.searchParams;

  const rawFollow = (params.get("follow") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (rawFollow.length > MAX_FOLLOWED) {
    return Response.json({ error: `Massimo ${MAX_FOLLOWED} autori per richiesta.` }, { status: 400 });
  }

  const followed: FollowSpec[] = [];
  for (const raw of rawFollow) {
    const spec = parseFollowInput(raw);
    if (!spec) {
      return Response.json(
        { error: `"${raw}" non è un username Hacker News né un dominio valido.` },
        { status: 400 },
      );
    }
    followed.push(spec);
  }

  const includePresets = params.get("presets") !== "0";
  const specs = [...(includePresets ? presetSpecs() : []), ...followed].filter(
    (spec, i, all) => all.findIndex((s) => s.id === spec.id) === i,
  );
  if (specs.length === 0) {
    return Response.json({ error: "Nessun autore richiesto." }, { status: 400 });
  }

  const response = await getStories(specs);
  const anySucceeded = response.authors.some((a) => !a.error);
  return Response.json(response, { status: anySucceeded ? 200 : 502 });
}
