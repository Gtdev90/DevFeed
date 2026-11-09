import { connection } from "next/server";
import { getFeed } from "@/lib/feed";
import type { FeedResponse } from "@/types/feed";

/**
 * GET /api/feed
 * Aggrega Hacker News (front page + archivio), Lobsters e Reddit.
 * Risponde 200 se almeno una fonte ha restituito dati, 502 se tutte sono fallite;
 * in entrambi i casi `sources` riporta l'esito di ciascuna fonte.
 */
export async function GET(): Promise<Response> {
  // Il feed deve essere calcolato a ogni richiesta (le singole fonti sono già in cache).
  await connection();
  const feed: FeedResponse = await getFeed();
  const anySucceeded = feed.sources.some((s) => s.ok);
  return Response.json(feed, { status: anySucceeded ? 200 : 502 });
}
