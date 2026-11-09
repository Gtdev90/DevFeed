import { ArrowUp, Landmark, MessageSquare } from "lucide-react";
import type { TechPost } from "@/types/feed";
import { formatCount, formatPostDate, publishedYear } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./source-badge";

interface PostCardProps {
  post: TechPost;
  /** Istante di riferimento per le date relative (deterministico tra server e client). */
  referenceIso: string;
}

export function PostCard({ post, referenceIso }: PostCardProps) {
  return (
    <article
      data-reveal
      className={cn(
        "group relative flex h-full flex-col gap-4 rounded-xl border border-line bg-obsidian-card p-5",
        "transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:bg-obsidian-raised",
        post.isArchive && "border-l-2 border-l-amber-glow/70",
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SourceBadge source={post.source} />
          {post.isArchive && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-amber-glow">
              <Landmark aria-hidden className="size-3" />
              Archivio {publishedYear(post.publishedAt)}
            </span>
          )}
        </div>
        <time
          dateTime={post.publishedAt}
          className="font-mono text-xs text-ink-mute"
          title={post.publishedAt}
        >
          {formatPostDate(post.publishedAt, referenceIso)}
        </time>
      </header>

      <h3 className="text-[15px] font-medium leading-snug text-ink">
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-emerald-cyber/70"
        >
          {post.title}
        </a>
      </h3>

      {post.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tag">
          {post.tags.slice(0, 4).map((tag) => (
            <li
              key={tag}
              className="rounded border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-ink-dim"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-auto flex items-center gap-4 pt-1 font-mono text-xs text-ink-dim">
        <span className="inline-flex items-center gap-1 text-emerald-cyber" title="Punteggio">
          <ArrowUp aria-hidden className="size-3.5" />
          <span className="sr-only">Punteggio: </span>
          {formatCount(post.points)}
        </span>
        <span className="inline-flex items-center gap-1" title="Commenti">
          <MessageSquare aria-hidden className="size-3.5" />
          <span className="sr-only">Commenti: </span>
          {formatCount(post.commentsCount)}
        </span>
        <span className="ml-auto truncate text-ink-mute" title={post.author}>
          @{post.author}
        </span>
      </footer>
    </article>
  );
}
