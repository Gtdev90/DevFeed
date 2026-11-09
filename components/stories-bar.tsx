"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { AuthorStories, StoriesResponse } from "@/types/stories";
import { authorFromSpec, hasUnread, parseFollowInput } from "@/lib/stories-core";
import { useStoriesState } from "@/lib/use-stories-state";
import { cn } from "@/lib/utils";
import { AuthorAvatar } from "./author-avatar";
import { StoryRing } from "./story-ring";
import { StoryViewer } from "./story-viewer";

const AVATAR = 64;

interface StoriesBarProps {
  /** Autori preimpostati con le loro storie reali, caricate lato server. */
  initial: AuthorStories[];
  fetchedAt: string;
}

/** `hn:antirez` → `antirez`, `domain:jvns.ca` → `jvns.ca`. */
const handleOf = (id: string) => id.replace(/^(hn|domain):/, "");

async function fetchCustom(ids: string[]): Promise<StoriesResponse | { error: string }> {
  try {
    const res = await fetch(`/api/stories?presets=0&follow=${encodeURIComponent(ids.map(handleOf).join(","))}`);
    const body = (await res.json()) as StoriesResponse | { error: string };
    return res.ok || "authors" in body ? body : { error: "error" in body ? body.error : "Errore sconosciuto" };
  } catch {
    return { error: "Impossibile contattare il server." };
  }
}

/** Carosello orizzontale di autori con anello animato e viewer a schermo intero. */
export function StoriesBar({ initial, fetchedAt }: StoriesBarProps) {
  const nowMs = useMemo(() => Date.parse(fetchedAt), [fetchedAt]);
  const { loaded, viewed, following, markViewed, follow, unfollow } = useStoriesState();

  const [custom, setCustom] = useState<AuthorStories[]>([]);
  const [viewer, setViewer] = useState<{ authorId: string; origin: { x: number; y: number } } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const listRef = useRef<HTMLUListElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const customLoaded = useRef(false);

  // Dopo il caricamento da IndexedDB, recupera le storie degli autori già seguiti.
  useEffect(() => {
    if (!loaded || customLoaded.current) return;
    customLoaded.current = true;
    if (following.length === 0) return;
    void fetchCustom(following).then((result) => {
      if ("authors" in result) {
        setCustom(result.authors);
      } else {
        setCustom(
          following.map((id) => ({
            author: authorFromSpec({ id, kind: id.startsWith("hn:") ? "hn_user" : "domain", query: handleOf(id) }),
            stories: [],
            error: result.error,
          })),
        );
      }
    });
  }, [loaded, following]);

  const all = useMemo(() => [...initial, ...custom.filter((c) => following.includes(c.author.id))], [initial, custom, following]);
  const viewable = useMemo(() => all.filter((a) => a.stories.length > 0), [all]);

  const openViewer = (authorId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    openerRef.current = element;
    setViewer({ authorId, origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } });
  };

  const closeViewer = useCallback(() => {
    setViewer(null);
    openerRef.current?.focus();
  }, []);

  const handleFollow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const spec = parseFollowInput(input);
    if (!spec) {
      setMessage("Inserisci uno username Hacker News (es. pg) o un sito (es. jvns.ca).");
      return;
    }
    if (all.some((a) => a.author.id === spec.id)) {
      setMessage(`Segui già ${handleOf(spec.id)}.`);
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await fetchCustom([spec.id]);
    setBusy(false);
    if (!("authors" in result)) {
      setMessage(result.error);
      return;
    }
    const entry = result.authors[0];
    if (!entry || entry.error) {
      setMessage(entry?.error ?? "Autore non trovato.");
      return;
    }
    if (entry.stories.length === 0) {
      setMessage(`Nessun post recente trovato per ${handleOf(spec.id)}.`);
      return;
    }
    follow(spec.id);
    setCustom((prev) => [...prev.filter((c) => c.author.id !== spec.id), entry]);
    setInput("");
    setFormOpen(false);
    requestAnimationFrame(() => listRef.current?.scrollTo({ left: listRef.current.scrollWidth, behavior: "smooth" }));
  };

  const handleUnfollow = (authorId: string) => {
    unfollow(authorId);
    setCustom((prev) => prev.filter((c) => c.author.id !== authorId));
    closeViewer();
  };

  return (
    <section aria-label="Tech Stories" className="border-b border-line py-5">
      <ul ref={listRef} className="no-scrollbar -mx-4 flex list-none snap-x gap-4 overflow-x-auto px-4 py-1 sm:mx-0 sm:px-0">
        {all.map(({ author, stories, error }) => {
          // Finché lo stato non è caricato nessun anello è "nuovo": evita un lampeggio per storie già viste.
          const unread = loaded && hasUnread(stories, viewed, nowMs);
          const disabled = stories.length === 0;
          return (
            <li key={author.id} className="w-[84px] shrink-0 snap-start">
              <button
                type="button"
                disabled={disabled}
                title={error ?? (disabled ? "Nessun post recente" : `${author.name} (@${author.handle})`)}
                aria-label={`Storie di ${author.name}${unread ? ", nuove" : ""}`}
                onClick={(e) => openViewer(author.id, e.currentTarget)}
                className="group flex w-full flex-col items-center gap-2 rounded-xl py-1 outline-none focus-visible:ring-2 focus-visible:ring-emerald-cyber/70 disabled:opacity-40"
              >
                <StoryRing unread={unread} frozen={viewer !== null} size={AVATAR}>
                  <AuthorAvatar author={author} size={AVATAR} className="transition-transform group-active:scale-95" />
                </StoryRing>
                <span className={cn("line-clamp-2 w-full text-center text-[11px] leading-tight", unread ? "text-ink" : "text-ink-mute")}>
                  {author.name}
                </span>
              </button>
            </li>
          );
        })}

        <li className="w-[84px] shrink-0 snap-start">
          <button
            type="button"
            aria-expanded={formOpen}
            aria-controls="follow-form"
            onClick={() => {
              setFormOpen((open) => !open);
              setMessage(null);
            }}
            className="group flex w-full flex-col items-center gap-2 rounded-xl py-1 outline-none focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
          >
            <span
              className="grid place-items-center rounded-full border border-dashed border-line-strong text-ink-dim transition group-hover:border-emerald-cyber/60 group-hover:text-emerald-cyber"
              style={{ width: AVATAR + 10, height: AVATAR + 10 }}
            >
              {formOpen ? <X aria-hidden className="size-6" /> : <Plus aria-hidden className="size-6" />}
            </span>
            <span className="text-center text-[11px] leading-tight text-ink-dim">+ Segui</span>
          </button>
        </li>
      </ul>

      {formOpen && (
        <form id="follow-form" onSubmit={handleFollow} className="mt-4 max-w-xl space-y-2">
          <label htmlFor="follow-input" className="block font-mono text-[11px] text-ink-dim">
            Username Hacker News o sito/blog da seguire
          </label>
          <div className="flex gap-2">
            <input
              id="follow-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="es. tptacek oppure paulgraham.com"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-line-strong bg-obsidian-card px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink-mute focus:border-emerald-cyber/60 focus-visible:ring-2 focus-visible:ring-emerald-cyber/40"
            />
            <button
              type="submit"
              disabled={busy || input.trim() === ""}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-cyber px-4 py-2 font-mono text-xs font-semibold text-obsidian outline-none transition hover:bg-emerald-400 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
            >
              {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              Segui
            </button>
          </div>
          <p role="status" aria-live="polite" className={cn("min-h-4 font-mono text-[11px]", message ? "text-amber-glow" : "text-ink-mute")}>
            {message ?? "Le storie sono gli ultimi post o commenti pubblicati su Hacker News."}
          </p>
        </form>
      )}

      {viewer && viewable.length > 0 && (
        <StoryViewer
          authors={viewable}
          startAuthorId={viewer.authorId}
          origin={viewer.origin}
          nowMs={nowMs}
          viewed={viewed}
          onViewed={markViewed}
          onUnfollow={handleUnfollow}
          onClose={closeViewer}
        />
      )}
    </section>
  );
}
