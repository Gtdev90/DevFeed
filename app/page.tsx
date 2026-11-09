import { Suspense } from "react";
import { Activity } from "lucide-react";
import { SettingsMenu } from "@/components/settings-menu";
import { FeedSection } from "@/components/feed-section";
import { FeedSkeleton } from "@/components/feed-skeleton";
import { StoriesSection, StoriesSkeleton } from "@/components/stories-section";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between border-b border-line py-6">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg border border-line-strong bg-obsidian-card">
            <Activity aria-hidden className="size-4 text-emerald-cyber" />
          </span>
          <div>
            <p className="font-mono text-sm font-semibold tracking-tight text-ink">
              PULSE<span className="text-emerald-cyber">.DEV</span>
            </p>
            <p className="font-mono text-[11px] text-ink-mute">il polso della tecnologia</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <p className="inline-flex items-center gap-2 font-mono text-xs text-ink-dim">
            <span aria-hidden className="live-dot size-2 rounded-full bg-emerald-cyber" />
            feed live
          </p>
          <SettingsMenu />
        </div>
      </header>

      <Suspense fallback={<StoriesSkeleton />}>
        <StoriesSection />
      </Suspense>

      <main className="pt-10">
        <div className="mb-10 max-w-3xl space-y-3">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Tutto ciò che conta in tech,{" "}
            <span className="text-emerald-cyber">in un solo feed.</span>
          </h1>
          <p className="text-base leading-relaxed text-ink-dim">
            Hacker News, Lobsters e Reddit aggregati in tempo reale, più le pietre miliari
            dell&apos;archivio che hanno fatto la storia.
          </p>
        </div>

        <Suspense fallback={<FeedSkeleton />}>
          <FeedSection />
        </Suspense>
      </main>
    </div>
  );
}
