import { ArrowUp, Bookmark, ExternalLink, EyeOff, MessageSquare, ThumbsUp } from "lucide-react";
import type { TechPost } from "@/types/feed";
import { formatCount, formatPostDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./source-badge";
import { SemanticBadge, type CardBadge } from "./semantic-badge";

interface PostCardProps {
  post: TechPost;
  /** Istante di riferimento per le date relative (deterministico tra server e client). */
  referenceIso: string;
  badge: CardBadge;
  liked: boolean;
  bookmarked: boolean;
  /** Finché true la card parte nascosta, in attesa dell'ingresso GSAP. */
  reveal: boolean;
  /** "stream" = card in lista; "deck" = card a tutto schermo (modalità Reel). */
  variant?: "stream" | "deck";
  onLike: (post: TechPost) => void;
  onBookmark: (post: TechPost) => void;
  onHide: (post: TechPost) => void;
  /** Click sul link dell'articolo (conta come "lettura"). */
  onRead: (post: TechPost) => void;
}

function ActionButton({
  label,
  pressed,
  disabled,
  tone,
  large,
  onClick,
  children,
}: {
  label: string;
  large?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  tone: "emerald" | "amber" | "neutral";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative z-10 grid place-items-center rounded-md border border-transparent text-ink-mute outline-none transition",
        large ? "size-11" : "size-8",
        "hover:border-line-strong hover:bg-white/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70",
        pressed && tone === "emerald" && "border-emerald-cyber/30 bg-emerald-cyber/10 text-emerald-cyber",
        pressed && tone === "amber" && "border-amber-glow/30 bg-amber-glow/10 text-amber-glow",
        disabled && "cursor-default",
      )}
    >
      {children}
    </button>
  );
}

export function PostCard({
  post,
  referenceIso,
  badge,
  liked,
  bookmarked,
  reveal,
  variant = "stream",
  onLike,
  onBookmark,
  onHide,
  onRead,
}: PostCardProps) {
  const deck = variant === "deck";
  return (
    <article
      data-reveal={reveal ? "" : undefined}
      data-slot={badge.kind}
      className={cn(
        "group relative flex h-full flex-col",
        deck
          ? "mx-auto w-full max-w-3xl justify-center gap-6 px-6 pb-24 pt-24 sm:px-12"
          : [
              "gap-3.5 rounded-xl border border-line bg-obsidian-card p-5",
              "transition-[border-color,background-color] duration-200 hover:border-line-strong hover:bg-obsidian-raised",
              badge.kind === "frontier" && "border-l-2 border-l-amber-glow/70",
              badge.kind === "archive" && "border-l-2 border-l-violet-archive/70",
            ],
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <SourceBadge source={post.source} />
        <p className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-ink-mute">
          <span className="truncate" title={post.author}>
            @{post.author}
          </span>
          <span aria-hidden>·</span>
          <time dateTime={post.publishedAt} className="shrink-0" title={post.publishedAt}>
            {formatPostDate(post.publishedAt, referenceIso)}
          </time>
        </p>
      </header>

      <SemanticBadge badge={badge} />

      <h3
        className={cn(
          "text-ink",
          deck ? "text-balance text-3xl font-semibold leading-[1.12] tracking-tight sm:text-5xl" : "text-[15px] font-medium leading-snug",
        )}
      >
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onRead(post)}
          onAuxClick={() => onRead(post)}
          // In lista l'intera card è cliccabile; nel Deck il link resta sul titolo per non
          // bloccare i gesti di trascinamento.
          className={cn(
            "outline-none focus-visible:ring-2 focus-visible:ring-emerald-cyber/70",
            !deck && "after:absolute after:inset-0 after:rounded-xl focus-visible:ring-0 focus-visible:after:ring-2 focus-visible:after:ring-emerald-cyber/70",
          )}
        >
          {post.title}
        </a>
      </h3>

      {deck && post.summarySnippet && (
        <p className="line-clamp-4 max-w-2xl text-base leading-relaxed text-ink-dim sm:text-lg">{post.summarySnippet}</p>
      )}

      {post.tags.length > 0 && (
        <ul className="flex list-none flex-wrap gap-1.5" aria-label="Tag">
          {post.tags.slice(0, deck ? 6 : 4).map((tag) => (
            <li
              key={tag}
              className="rounded border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-ink-dim"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}

      <footer className={cn("flex items-center gap-3 font-mono text-ink-dim", deck ? "pt-2 text-sm" : "mt-auto pt-1 text-xs")}>
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

        <div className="-mr-1.5 ml-auto flex items-center gap-0.5">
          <ActionButton
            label={liked ? "Mi piace (registrato)" : "Mi piace"}
            pressed={liked}
            disabled={liked}
            tone="emerald"
            large={deck}
            onClick={() => onLike(post)}
          >
            <ThumbsUp aria-hidden className="size-4" />
          </ActionButton>
          <ActionButton
            label={bookmarked ? "Salvato nei segnalibri" : "Salva nei segnalibri"}
            pressed={bookmarked}
            disabled={bookmarked}
            tone="amber"
            large={deck}
            onClick={() => onBookmark(post)}
          >
            <Bookmark aria-hidden className={cn("size-4", bookmarked && "fill-current")} />
          </ActionButton>
          <ActionButton label="Nascondi questo post" tone="neutral" large={deck} onClick={() => onHide(post)}>
            <EyeOff aria-hidden className="size-4" />
          </ActionButton>
        </div>
      </footer>

      {deck && (
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onRead(post)}
          className="inline-flex items-center gap-2 self-start rounded-xl bg-emerald-cyber px-5 py-3 text-sm font-semibold text-obsidian outline-none transition hover:bg-emerald-400 focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <ExternalLink aria-hidden className="size-4" />
          Apri articolo
        </a>
      )}
    </article>
  );
}
