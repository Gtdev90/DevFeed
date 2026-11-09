import { connection } from "next/server";
import { getStories, presetSpecs } from "@/lib/stories";
import { StoriesBar } from "./stories-bar";

/** Server Component: carica le storie reali degli autori preimpostati. */
export async function StoriesSection() {
  await connection();
  const { authors, fetchedAt } = await getStories(presetSpecs());
  return <StoriesBar initial={authors} fetchedAt={fetchedAt} />;
}

/** Placeholder strutturale durante il caricamento (nessun dato finto). */
export function StoriesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Caricamento delle storie" className="flex gap-4 border-b border-line py-5">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex w-[84px] shrink-0 flex-col items-center gap-2">
          <div className="size-[74px] animate-pulse rounded-full bg-obsidian-card" />
          <div className="h-2.5 w-14 animate-pulse rounded bg-obsidian-card" />
        </div>
      ))}
    </div>
  );
}
