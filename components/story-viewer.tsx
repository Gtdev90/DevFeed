"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { Observer } from "gsap/Observer";
import { useGSAP } from "@gsap/react";
import { ChevronLeft, ChevronRight, ExternalLink, MessageSquare, Pause, Play, UserMinus, X } from "lucide-react";
import type { AuthorStories } from "@/types/stories";
import { chronological, formatAge, startIndex } from "@/lib/stories-core";
import { cn } from "@/lib/utils";
import { AuthorAvatar } from "./author-avatar";

gsap.registerPlugin(useGSAP, Observer);

/** Durata di ogni storia. */
const STORY_SECONDS = 8;
/** Pressione prolungata oltre questa soglia = pausa. */
const HOLD_MS = 180;
/** Spostamento massimo (px) per considerare un gesto un tap. */
const TAP_SLOP = 10;
/** Il 30% sinistro dello schermo torna indietro, il 70% destro va avanti. */
const LEFT_ZONE = 0.3;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface StoryViewerProps {
  /** Autori con almeno una storia, nell'ordine della barra. */
  authors: AuthorStories[];
  startAuthorId: string;
  /** Punto (coordinate viewport) da cui parte lo zoom: il centro dell'avatar cliccato. */
  origin: { x: number; y: number } | null;
  /** Istante di riferimento per le età relative. */
  nowMs: number;
  /** Storie già viste: serve a far partire il viewer dalla prima non vista. */
  viewed: ReadonlySet<string>;
  onViewed: (storyId: string) => void;
  onUnfollow?: (authorId: string) => void;
  onClose: () => void;
}

interface Position {
  /** Indice dell'autore. */
  a: number;
  /** Indice della storia dell'autore. */
  s: number;
}

/** Visualizzatore a schermo intero in stile Instagram, pilotato da GSAP. */
export function StoryViewer({
  authors,
  startAuthorId,
  origin,
  nowMs,
  viewed,
  onViewed,
  onUnfollow,
  onClose,
}: StoryViewerProps) {
  const ordered = useMemo(
    () => authors.map((a) => ({ ...a, stories: chronological(a.stories) })),
    [authors],
  );

  const [pos, setPos] = useState<Position>(() => {
    const a = Math.max(0, ordered.findIndex((x) => x.author.id === startAuthorId));
    return { a, s: startIndex(ordered[a].stories, viewed) };
  });
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fillRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const posRef = useRef(pos);
  const viewedRef = useRef(viewed);
  const onViewedRef = useRef(onViewed);
  const pausedRef = useRef(false);
  const holdRef = useRef(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);
  const closingRef = useRef(false);
  const dirRef = useRef(1);
  const prevAuthorRef = useRef(pos.a);

  useEffect(() => {
    posRef.current = pos;
    viewedRef.current = viewed;
    onViewedRef.current = onViewed;
  });

  const syncPause = () => tlRef.current?.paused(holdRef.current || pausedRef.current);

  /* ───────────── Navigazione ───────────── */

  const go = (next: Position, dir: 1 | -1) => {
    dirRef.current = dir;
    setPos(next);
  };
  const firstUnseen = (authorIndex: number) => startIndex(ordered[authorIndex].stories, viewedRef.current);

  const close = (via: "button" | "swipe") => {
    if (closingRef.current) return;
    closingRef.current = true;
    tlRef.current?.pause();
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    gsap.to(backdropRef.current, { backgroundColor: "rgba(0,0,0,0)", duration: 0.3, ease: "power2.in" });
    gsap.to(overlayRef.current, {
      autoAlpha: 0,
      scale: via === "swipe" ? 1 : 0.88,
      y: via === "swipe" ? 180 : 0,
      duration: 0.38,
      ease: "power3.in",
      onComplete: onClose,
    });
  };

  const next = () => {
    const { a, s } = posRef.current;
    if (s < ordered[a].stories.length - 1) go({ a, s: s + 1 }, 1);
    else if (a < ordered.length - 1) go({ a: a + 1, s: firstUnseen(a + 1) }, 1);
    else close("button");
  };
  const prev = () => {
    const { a, s } = posRef.current;
    if (s > 0) go({ a, s: s - 1 }, -1);
    else if (a > 0) go({ a: a - 1, s: 0 }, -1);
    else go({ a, s: 0 }, -1); // già all'inizio: riparte la prima storia
  };
  const author = (delta: 1 | -1) => {
    const { a } = posRef.current;
    const target = a + delta;
    if (target < 0 || target >= ordered.length) {
      // Ai capi della barra: piccolo rimbalzo invece di una chiusura a sorpresa.
      gsap.fromTo(cardRef.current, { x: delta * 28 }, { x: 0, duration: 0.6, ease: "elastic.out(1, 0.5)" });
      return;
    }
    go({ a: target, s: delta === 1 ? firstUnseen(target) : 0 }, delta);
  };

  // Le callback GSAP/Observer vivono oltre il render: leggono sempre l'ultima versione.
  const actions = useRef({ next, prev, author, close });
  useEffect(() => {
    actions.current = { next, prev, author, close };
  });

  /* ───────────── Apertura: zoom-in a schermo intero ───────────── */

  useGSAP(
    () => {
      const overlay = overlayRef.current;
      const backdrop = backdropRef.current;
      if (!overlay || !backdrop) return;
      if (prefersReducedMotion()) {
        gsap.set(overlay, { autoAlpha: 1 });
        gsap.set(backdrop, { backgroundColor: "rgba(0,0,0,0.88)" });
        return;
      }
      const ox = origin?.x ?? window.innerWidth / 2;
      const oy = origin?.y ?? window.innerHeight / 2;
      gsap.set(overlay, { transformOrigin: `${ox}px ${oy}px` });
      gsap.fromTo(
        overlay,
        { autoAlpha: 0, scale: 0.15 },
        { autoAlpha: 1, scale: 1, duration: 0.55, ease: "power3.out" },
      );
      // Il blur anima solo durante la transizione: a regime resta uno sfondo scuro più opaco,
      // perché un backdrop-filter a schermo intero costa un ricalcolo a ogni frame del timer.
      gsap.fromTo(
        backdrop,
        { backdropFilter: "blur(0px)", backgroundColor: "rgba(0,0,0,0.5)" },
        {
          backdropFilter: "blur(16px)",
          backgroundColor: "rgba(0,0,0,0.88)",
          duration: 0.55,
          ease: "power2.out",
          onComplete: () => {
            gsap.set(backdrop, { backdropFilter: "none" });
          },
        },
      );
    },
    { scope: overlayRef },
  );

  /* ───────────── Timeline di avanzamento (8 s per storia) ───────────── */

  useGSAP(
    () => {
      const { a, s } = pos;
      const story = ordered[a].stories[s];
      onViewedRef.current(story.id);

      // useGSAP non esegue il cleanup alla modifica delle dipendenze: la timeline della
      // storia precedente va fermata a mano, altrimenti al suo termine chiamerebbe next().
      tlRef.current?.kill();
      tlRef.current = null;

      const fills = fillRefs.current;
      fills.forEach((fill, i) => {
        if (fill) gsap.set(fill, { scaleX: i < s ? 1 : 0 });
      });

      const fill = fills[s];
      let tl: gsap.core.Timeline | null = null;
      if (fill) {
        tl = gsap.timeline({ onComplete: () => actions.current.next() });
        tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: STORY_SECONDS, ease: "none" });
        tl.paused(holdRef.current || pausedRef.current);
        tlRef.current = tl;
      }

      // Ingresso della card: slide laterale tra autori, dissolvenza leggera tra storie.
      const authorChanged = prevAuthorRef.current !== a;
      prevAuthorRef.current = a;
      if (!prefersReducedMotion()) {
        gsap.fromTo(
          cardRef.current,
          { autoAlpha: 0, x: dirRef.current * (authorChanged ? 56 : 14) },
          { autoAlpha: 1, x: 0, duration: authorChanged ? 0.45 : 0.3, ease: "power3.out", overwrite: true },
        );
      }

      return () => {
        tl?.kill();
      };
    },
    { dependencies: [pos.a, pos.s], revertOnUpdate: true },
  );

  /* ───────────── Swipe con GSAP Observer ───────────── */

  useGSAP(
    () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      let latched = false; // un solo cambio per gesto, anche se il drag continua
      const fire = (action: () => void) => {
        if (latched || closingRef.current) return;
        latched = true;
        swipedRef.current = true;
        window.clearTimeout(holdTimer.current);
        action();
      };
      const observer = Observer.create({
        target: overlay,
        type: "pointer",
        tolerance: 40,
        dragMinimum: 6,
        preventDefault: true,
        ignore: "a, button",
        onLeft: () => fire(() => actions.current.author(1)),
        onRight: () => fire(() => actions.current.author(-1)),
        onDown: () => fire(() => actions.current.close("swipe")),
        onRelease: () => {
          latched = false;
        },
      });
      return () => observer.kill();
    },
    { scope: overlayRef },
  );

  /* ───────────── Tap & hold ───────────── */

  const endPress = (event: React.PointerEvent, allowTap: boolean) => {
    const start = downRef.current;
    if (!start) return;
    downRef.current = null;
    window.clearTimeout(holdTimer.current);
    const wasHolding = holdRef.current;
    holdRef.current = false;
    setHolding(false);
    syncPause(); // al rilascio la timeline riparte (tl.play())
    if (!allowTap || wasHolding || swipedRef.current) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    if ((event.clientX - rect.left) / rect.width < LEFT_ZONE) actions.current.prev();
    else actions.current.next();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    downRef.current = { x: event.clientX, y: event.clientY };
    swipedRef.current = false;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdRef.current = true;
      setHolding(true);
      syncPause(); // tenendo premuto la timeline va in pausa (tl.pause())
    }, HOLD_MS);
  };

  /* ───────────── Tastiera, visibilità, scroll lock ───────────── */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") actions.current.close("button");
      else if (event.key === "ArrowRight") actions.current.next();
      else if (event.key === "ArrowLeft") actions.current.prev();
      else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
        syncPause();
      }
    };
    // Con la scheda in background il tempo non deve scorrere.
    const onVisibility = () => tlRef.current?.paused(document.hidden || holdRef.current || pausedRef.current);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    overlayRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      document.documentElement.style.overflow = previousOverflow;
      window.clearTimeout(holdTimer.current);
    };
  }, []);

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    syncPause();
  };

  const current = ordered[pos.a];
  const story = current.stories[pos.s];
  const { abstract } = story;
  const factsGrid = abstract.facts.length >= 3 ? "grid-cols-3" : abstract.facts.length === 2 ? "grid-cols-2" : "grid-cols-1";

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Storie di ${current.author.name}`}
      tabIndex={-1}
      className="invisible fixed inset-0 z-[100] touch-none select-none opacity-0 outline-none"
    >
      <div ref={backdropRef} onClick={() => actions.current.close("button")} className="absolute inset-0" />

      <button
        type="button"
        aria-label="Autore precedente"
        onClick={() => actions.current.author(-1)}
        disabled={pos.a === 0}
        className="absolute left-4 top-1/2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-obsidian-card/80 text-ink outline-none transition hover:bg-obsidian-raised focus-visible:ring-2 focus-visible:ring-emerald-cyber/70 disabled:opacity-30 md:grid"
      >
        <ChevronLeft aria-hidden className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Autore successivo"
        onClick={() => actions.current.author(1)}
        disabled={pos.a === ordered.length - 1}
        className="absolute right-4 top-1/2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-obsidian-card/80 text-ink outline-none transition hover:bg-obsidian-raised focus-visible:ring-2 focus-visible:ring-emerald-cyber/70 disabled:opacity-30 md:grid"
      >
        <ChevronRight aria-hidden className="size-5" />
      </button>

      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerUp={(e) => endPress(e, true)}
        onPointerCancel={(e) => endPress(e, false)}
        onContextMenu={(e) => e.preventDefault()}
        className="relative mx-auto flex h-full w-full max-w-[440px] flex-col overflow-hidden bg-obsidian-card sm:my-[3dvh] sm:h-[94dvh] sm:rounded-3xl sm:border sm:border-line-strong"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(120% 60% at 50% 0%, rgba(99,102,241,0.22), transparent 70%), radial-gradient(90% 40% at 50% 100%, rgba(34,211,238,0.10), transparent 70%)",
          }}
        />

        <header className="relative z-10 space-y-3 px-4 pt-4">
          <div className="flex gap-1" aria-hidden>
            {current.stories.map((s, i) => (
              <span key={`${current.author.id}-${s.id}`} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/20">
                <span
                  ref={(el) => {
                    fillRefs.current[i] = el;
                  }}
                  data-fill={i}
                  style={{ transform: "scaleX(0)" }}
                  className="block h-full origin-left rounded-full bg-white will-change-transform"
                />
              </span>
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            Storia {pos.s + 1} di {current.stories.length} di {current.author.name}
          </p>

          <div className="flex items-center gap-3">
            <AuthorAvatar author={current.author} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{current.author.name}</p>
              <p className="truncate font-mono text-[11px] text-ink-dim">
                @{current.author.handle} · {formatAge(story.publishedAt, nowMs)}
                {holding && " · in pausa"}
              </p>
            </div>
            <button
              type="button"
              onClick={togglePause}
              aria-label={paused ? "Riprendi" : "Metti in pausa"}
              className="grid size-9 place-items-center rounded-full text-ink-dim outline-none transition hover:bg-white/10 hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
            >
              {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => actions.current.close("button")}
              aria-label="Chiudi le storie"
              className="grid size-9 place-items-center rounded-full text-ink outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
        </header>

        <div ref={cardRef} className="relative z-10 flex flex-1 flex-col gap-5 overflow-hidden px-6 pb-6 pt-8">
          <span className="self-start rounded-md border border-cyan-pulse/30 bg-cyan-pulse/10 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-cyan-pulse">
            {abstract.kicker}
          </span>

          <h2 className="text-balance text-[28px] font-semibold leading-[1.15] tracking-tight text-ink">
            {story.title}
          </h2>

          <div className="space-y-3">
            {abstract.lead ? (
              <p className="text-[15px] leading-relaxed text-ink">{abstract.lead}</p>
            ) : (
              <p className="text-sm leading-relaxed text-ink-mute">
                Questo post non include un testo: apri la discussione per leggere il contesto.
              </p>
            )}
            {abstract.bullets.length > 0 && (
              <ul className="list-none space-y-2">
                {abstract.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2.5 text-sm leading-relaxed text-ink-dim">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-indigo-pulse" />
                    {bullet}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {abstract.topics.length > 0 && (
            <ul className="flex list-none flex-wrap gap-1.5" aria-label="Argomenti">
              {abstract.topics.map((topic) => (
                <li
                  key={topic}
                  className="rounded border border-emerald-cyber/30 bg-emerald-cyber/10 px-2 py-0.5 font-mono text-[11px] text-emerald-cyber"
                >
                  {topic}
                </li>
              ))}
            </ul>
          )}

          <dl className={cn("grid gap-2 rounded-xl border border-line bg-black/20 p-3 font-mono", factsGrid)}>
            {abstract.facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-[10px] uppercase tracking-wider text-ink-mute">{fact.label}</dt>
                <dd className="truncate text-xs text-ink" title={fact.value}>
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-auto space-y-2.5">
            <a
              href={story.discussionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-cyber px-4 py-3 text-sm font-semibold text-obsidian outline-none transition hover:bg-emerald-400 focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <MessageSquare aria-hidden className="size-4" />
              Apri Discussione Completa
            </a>
            {story.url !== story.discussionUrl && (
              <a
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl border border-line-strong px-4 py-2.5 text-sm text-ink-dim outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
              >
                <ExternalLink aria-hidden className="size-4" />
                {story.kind === "comment" ? "Vai all'articolo discusso" : "Leggi l'articolo"}
              </a>
            )}
            {!current.author.preset && onUnfollow && (
              <button
                type="button"
                onClick={() => onUnfollow(current.author.id)}
                className="mx-auto flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] text-ink-mute outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
              >
                <UserMinus aria-hidden className="size-3" />
                Smetti di seguire @{current.author.handle}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
