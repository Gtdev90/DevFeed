"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { Observer } from "gsap/Observer";
import { useGSAP } from "@gsap/react";
import { ChevronDown, ChevronUp, Languages, Loader2, Radar, RefreshCw, X } from "lucide-react";
import type { TechPost } from "@/types/feed";
import {
  DEFAULT_EPSILON,
  DIMENSIONS,
  DIMENSION_META,
  badgeDimension,
  cosineSimilarity,
  matchPercent,
  rankFeed,
  uniformVector,
  vectorizePost,
  type PostVector,
  type RankedPost,
  type Vector,
} from "@/lib/algorithm";
import { publishedYear } from "@/lib/format";
import { useTasteProfile } from "@/lib/use-taste-profile";
import { useTranslatedTitles } from "@/lib/use-translated-titles";
import { cn } from "@/lib/utils";
import { ArticleDrawer } from "./article-drawer";
import { PostCard } from "./post-card";
import { usePrefs } from "./prefs-provider";
import type { CardBadge } from "./semantic-badge";
import { VectorRadar } from "./vector-radar";
import { ViewToggle, type ViewMode } from "./view-toggle";

gsap.registerPlugin(useGSAP, Flip, Observer);

/** Attesa prima di riordinare dopo un cambio di preferenze (raggruppa click ravvicinati). */
const PREFERENCE_DEBOUNCE_MS = 300;
/** Distanza (px) o impulso di scroll oltre cui il Deck passa alla card successiva. */
const DECK_TOLERANCE = 60;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Sfondo del Deck in base al tipo di card: verde (exploit), oro (fuori bolla), viola (archivio). */
const DECK_GLOW: Record<CardBadge["kind"], string> = {
  match: "rgba(16,185,129,0.14)",
  neutral: "rgba(99,102,241,0.12)",
  frontier: "rgba(245,158,11,0.16)",
  archive: "rgba(139,92,246,0.18)",
};

type ModeFlip =
  | { kind: "to-deck"; state: Flip.FlipState; index: number }
  | { kind: "to-stream"; state: Flip.FlipState; index: number };

/**
 * Posiziona le card del Deck: una sola visibile, le altre fuori schermo sopra/sotto.
 * `skip` esclude la card già animata da Flip; `fadeCurrent` la fa comparire con un fade.
 */
function layoutDeck(lis: HTMLElement[], index: number, skip = -1, fadeCurrent = false) {
  const vh = window.innerHeight;
  lis.forEach((li, i) => {
    if (i === skip) return;
    if (i === index) {
      if (fadeCurrent && !prefersReducedMotion()) {
        gsap.fromTo(li, { autoAlpha: 0, y: 0, scale: 0.96, rotation: 0, zIndex: 1 }, { autoAlpha: 1, scale: 1, duration: 0.4, ease: "power2.out" });
      } else {
        gsap.set(li, { autoAlpha: 1, y: 0, scale: 1, rotation: 0, zIndex: 1 });
      }
    } else {
      gsap.set(li, { autoAlpha: 0, y: i < index ? -vh : vh, scale: 0.92, rotation: 0, zIndex: 0 });
    }
  });
}

interface FeedExperienceProps {
  posts: TechPost[];
  /** Istante in cui il feed è stato composto: riferimento per decay e date relative. */
  fetchedAt: string;
}

/**
 * Feed personalizzato: ranking epsilon-greedy, azioni (like / segnalibro / nascondi),
 * profilo persistito in IndexedDB, pannello Live Vector Radar e due modalità di lettura:
 *  - Stream: griglia a scorrimento verticale standard;
 *  - Deck: card a tutto schermo con navigazione verticale (GSAP Observer).
 * Il passaggio tra le due modalità è animato con GSAP Flip.
 *
 * Le percentuali di affinità si aggiornano subito a ogni interazione; l'ordine delle card
 * cambia solo su "Ricalcola Feed" o al cambio di preferenze (slider ε, override).
 */
export function FeedExperience({ posts, fetchedAt }: FeedExperienceProps) {
  const nowMs = useMemo(() => Date.parse(fetchedAt), [fetchedAt]);
  const vectors = useMemo(
    () => new Map<string, PostVector>(posts.map((p) => [p.id, vectorizePost(p)])),
    [posts],
  );
  const rank = useCallback(
    (user: Vector, epsilon: number) => rankFeed(posts, vectors, user, { epsilon, now: nowMs }),
    [posts, vectors, nowMs],
  );

  // Ranking iniziale deterministico (profilo uniforme): identico su server e client.
  const [ranking, setRanking] = useState<RankedPost[]>(() => rank(uniformVector(), DEFAULT_EPSILON));
  const [dirty, setDirty] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [radarOpen, setRadarOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [mode, setMode] = useState<ViewMode>("stream");
  const [inspect, setInspect] = useState<TechPost | null>(null);
  const { lang, translateTitles, setTranslateTitles } = usePrefs();
  const [deckIndex, setDeckIndex] = useState(0);

  const { profile, ready, interact, override, setEpsilon, reset } = useTasteProfile({
    onLoaded: (loaded) => setRanking(rank(loaded.userVector, loaded.epsilon)),
  });

  const wrapperRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const modeFlip = useRef<ModeFlip | null>(null);
  const profileRef = useRef(profile);
  const visibleKeyRef = useRef("");
  const modeRef = useRef<ViewMode>("stream");
  const prevModeRef = useRef<ViewMode>("stream");
  const introDoneRef = useRef(false);
  const deckIndexRef = useRef(0);
  const deckAnimating = useRef(false);
  const debounceTimer = useRef<number | undefined>(undefined);
  const leaving = useRef(new Set<string>());

  const hidden = useMemo(() => new Set(profile.hidden), [profile.hidden]);
  const visible = useMemo(() => ranking.filter((r) => !hidden.has(r.post.id)), [ranking, hidden]);
  const visibleKey = visible.map((r) => r.post.id).join("|");
  const safeDeckIndex = Math.min(deckIndex, Math.max(0, visible.length - 1));
  const visiblePosts = useMemo(() => visible.map((r) => r.post), [visible]);
  const translated = useTranslatedTitles(visiblePosts, translateTitles, lang);

  useEffect(() => {
    profileRef.current = profile;
    visibleKeyRef.current = visibleKey;
    modeRef.current = mode;
    introDoneRef.current = introDone;
    deckIndexRef.current = Math.min(deckIndexRef.current, Math.max(0, visible.length - 1));
  });
  useEffect(() => () => window.clearTimeout(debounceTimer.current), []);

  const liked = useMemo(() => new Set(profile.liked), [profile.liked]);
  const bookmarked = useMemo(() => new Set(profile.bookmarked), [profile.bookmarked]);

  const getItems = useCallback(
    (): HTMLElement[] =>
      gridRef.current ? (Array.from(gridRef.current.children) as HTMLElement[]).filter((el) => el.dataset.flipId) : [],
    [],
  );

  /** Fotografa le posizioni attuali delle card: va chiamata PRIMA del cambio di stato. */
  const captureFlip = useCallback(() => {
    // Nel Deck le card sono sovrapposte: il riordino non ha nulla da animare con Flip.
    flipState.current =
      gridRef.current && modeRef.current === "stream" && !prefersReducedMotion()
        ? Flip.getState(getItems())
        : null;
  }, [getItems]);

  const resetDeck = useCallback(() => {
    deckIndexRef.current = 0;
    setDeckIndex(0);
  }, []);

  const recompute = useCallback(() => {
    const { userVector, epsilon, hidden: hiddenIds } = profileRef.current;
    const next = rank(userVector, epsilon);
    const hiddenSet = new Set(hiddenIds);
    const nextKey = next
      .filter((r) => !hiddenSet.has(r.post.id))
      .map((r) => r.post.id)
      .join("|");
    if (nextKey !== visibleKeyRef.current) {
      captureFlip();
      if (modeRef.current === "deck") resetDeck();
    }
    setRanking(next);
    setDirty(false);
    setAnnouncement(`Feed ricalcolato: ${nextKey ? nextKey.split("|").length : 0} post.`);
  }, [rank, captureFlip, resetDeck]);

  const scheduleRecompute = useCallback(() => {
    window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(recompute, PREFERENCE_DEBOUNCE_MS);
  }, [recompute]);

  const vectorOf = useCallback((post: TechPost): Vector => vectors.get(post.id)?.vector ?? uniformVector(), [vectors]);

  const handleLike = useCallback(
    (post: TechPost) => {
      interact("like", post.id, vectorOf(post));
      setDirty(true);
    },
    [interact, vectorOf],
  );
  const handleBookmark = useCallback(
    (post: TechPost) => {
      interact("bookmark", post.id, vectorOf(post));
      setDirty(true);
    },
    [interact, vectorOf],
  );
  const handleRead = useCallback(
    (post: TechPost) => {
      interact("read", post.id, vectorOf(post));
      setDirty(true);
    },
    [interact, vectorOf],
  );

  /** Apre il drawer con sintesi e fonte; l'apertura conta come lettura per il profilo. */
  const handleInspect = useCallback(
    (post: TechPost) => {
      interact("read", post.id, vectorOf(post));
      setDirty(true);
      setInspect(post);
    },
    [interact, vectorOf],
  );

  const closeInspect = useCallback(() => {
    setInspect((current) => {
      if (current) {
        // Riporta il focus sulla card da cui si era partiti.
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(current.id)}"] h3 a`)?.focus({ preventScroll: true }),
        );
      }
      return null;
    });
  }, []);

  const handleHide = useCallback(
    (post: TechPost) => {
      if (leaving.current.has(post.id)) return;
      leaving.current.add(post.id);
      const commit = () => {
        captureFlip(); // le card rimaste scorrono a coprire il vuoto
        interact("skip", post.id, vectorOf(post));
        setDirty(true);
        leaving.current.delete(post.id);
      };
      const card = gridRef.current?.querySelector(`[data-flip-id="${CSS.escape(post.id)}"] article`);
      if (card && !prefersReducedMotion()) {
        gsap.to(card, { autoAlpha: 0, scale: 0.92, duration: 0.25, ease: "power2.in", onComplete: commit });
      } else {
        commit();
      }
    },
    [captureFlip, interact, vectorOf],
  );

  const handleEpsilon = useCallback(
    (epsilon: number) => {
      setEpsilon(epsilon);
      scheduleRecompute();
    },
    [setEpsilon, scheduleRecompute],
  );

  const handleOverride = useCallback(
    (index: number, direction: 1 | -1) => {
      override(index, direction);
      scheduleRecompute();
    },
    [override, scheduleRecompute],
  );

  const handleReset = useCallback(() => {
    window.clearTimeout(debounceTimer.current);
    const fresh = reset();
    captureFlip();
    if (modeRef.current === "deck") resetDeck();
    setRanking(rank(fresh.userVector, fresh.epsilon));
    setDirty(false);
    setAnnouncement("Profilo azzerato.");
  }, [reset, rank, captureFlip, resetDeck]);

  /* ───────────── Passaggio Stream ⇄ Deck (GSAP Flip) ───────────── */

  const switchMode = useCallback(
    (next: ViewMode) => {
      const grid = gridRef.current;
      if (!grid || next === modeRef.current || !introDoneRef.current) return;
      const items = getItems();
      if (items.length === 0) return;
      const animate = !prefersReducedMotion();

      if (next === "deck") {
        // Parte dalla card più in alto tra quelle visibili in pagina.
        const first = items.findIndex((li) => li.getBoundingClientRect().bottom > 140);
        const index = first === -1 ? 0 : first;
        // La griglia esce dal flusso (diventa fixed): si mantiene l'altezza per non perdere lo scroll.
        if (wrapperRef.current) wrapperRef.current.style.minHeight = `${grid.offsetHeight}px`;
        modeFlip.current = animate ? { kind: "to-deck", state: Flip.getState(items[index]), index } : null;
        deckIndexRef.current = index;
        setDeckIndex(index);
      } else {
        const index = Math.min(deckIndexRef.current, items.length - 1);
        modeFlip.current = animate ? { kind: "to-stream", state: Flip.getState(items[index]), index } : null;
      }
      modeRef.current = next;
      setMode(next);
    },
    [getItems],
  );

  useGSAP(
    () => {
      const previous = prevModeRef.current;
      prevModeRef.current = mode;
      if (previous === mode) return;
      const pending = modeFlip.current;
      modeFlip.current = null;
      const items = getItems();
      if (items.length === 0) return;

      if (mode === "deck") {
        const index = Math.min(deckIndexRef.current, items.length - 1);
        layoutDeck(items, index, pending ? index : -1);
        if (pending?.kind === "to-deck") {
          const current = items[index];
          gsap.set(current, { autoAlpha: 1, zIndex: 2 });
          // La card cliccata si espande dalla sua posizione in griglia fino a occupare lo schermo.
          Flip.from(pending.state, {
            duration: 0.85,
            ease: "power3.inOut",
            scale: false,
            onComplete: () => {
              gsap.set(current, { zIndex: 1 });
            },
          });
          gsap.fromTo(current.querySelector("article"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.45, delay: 0.4 });
        }
      } else {
        gsap.set(items, { clearProps: "all" });
        if (wrapperRef.current) wrapperRef.current.style.minHeight = "";
        if (pending?.kind === "to-stream") {
          const current = items[pending.index];
          current.scrollIntoView({ block: "center" });
          // La card corrente torna dallo schermo intero al suo posto in griglia.
          Flip.from(pending.state, { duration: 0.8, ease: "power3.inOut", scale: false });
          gsap.fromTo(current.querySelector("article"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.45, delay: 0.35 });
          gsap.from(
            items.filter((li) => li !== current),
            { autoAlpha: 0, y: 28, duration: 0.5, delay: 0.3, ease: "power2.out", stagger: { amount: 0.5 }, clearProps: "all" },
          );
        }
      }
    },
    { scope: gridRef, dependencies: [mode] },
  );

  /* ───────────── Deck: navigazione verticale ───────────── */

  const gotoDeck = useCallback(
    (target: number) => {
      if (deckAnimating.current) return;
      const items = getItems();
      const current = deckIndexRef.current;
      if (target < 0 || target >= items.length || target === current) {
        // Ai capi della lista: la card rimbalza invece di restare ferma.
        if (items[current] && !prefersReducedMotion()) {
          const dir = target < current ? 1 : -1;
          gsap.fromTo(items[current], { y: dir * 36 }, { y: 0, duration: 0.8, ease: "elastic.out(1, 0.5)", overwrite: "auto" });
        }
        return;
      }

      const dir = target > current ? 1 : -1;
      const from = items[current];
      const to = items[target];
      deckIndexRef.current = target;
      setDeckIndex(target);
      deckAnimating.current = true;

      if (prefersReducedMotion()) {
        gsap.set(from, { autoAlpha: 0, y: dir * -window.innerHeight });
        gsap.set(to, { autoAlpha: 1, y: 0, scale: 1, rotation: 0 });
        deckAnimating.current = false;
        return;
      }

      const vh = window.innerHeight;
      gsap.set(to, { autoAlpha: 1, y: dir * vh, scale: 0.92, rotation: dir * 4, zIndex: 2 });
      gsap.set(from, { zIndex: 1 });
      gsap
        .timeline({
          onComplete: () => {
            gsap.set(from, { autoAlpha: 0, y: -dir * vh, scale: 0.92, rotation: 0, zIndex: 0 });
            gsap.set(to, { zIndex: 1 });
            // Piccolo margine: l'inerzia di un trackpad non deve far saltare due card.
            window.setTimeout(() => {
              deckAnimating.current = false;
            }, 220);
          },
        })
        .to(from, { y: -dir * vh * 0.4, scale: 0.9, rotation: -dir * 3, autoAlpha: 0, duration: 0.6, ease: "power2.in" }, 0)
        .to(to, { y: 0, scale: 1, rotation: 0, duration: 0.95, ease: "elastic.out(1, 0.7)" }, 0.08);
    },
    [getItems],
  );

  // Gesti del Deck: rotella, touch e mouse tramite GSAP Observer.
  useGSAP(
    () => {
      const grid = gridRef.current;
      if (mode !== "deck" || !grid) return;
      let latched = false; // una sola card per gesto di trascinamento
      let moved = false; // il gesto è stato un trascinamento: non deve diventare un click
      const currentItem = () => getItems()[deckIndexRef.current];

      // Un trascinamento che parte su un link o un pulsante non deve aprirlo al rilascio.
      const swallowClickAfterDrag = (event: MouseEvent) => {
        if (!moved) return;
        moved = false;
        event.preventDefault();
        event.stopPropagation();
      };
      grid.addEventListener("click", swallowClickAfterDrag, true);

      const observer = Observer.create({
        target: grid,
        type: "wheel,touch,pointer",
        wheelSpeed: -1,
        tolerance: DECK_TOLERANCE,
        dragMinimum: 6,
        preventDefault: true,
        onPress: () => {
          moved = false;
        },
        onUp: (self) => {
          if (self.isDragging) {
            if (latched) return;
            latched = true;
          }
          gotoDeck(deckIndexRef.current + 1);
        },
        onDown: (self) => {
          if (self.isDragging) {
            if (latched) return;
            latched = true;
          }
          gotoDeck(deckIndexRef.current - 1);
        },
        // Durante il trascinamento la card segue il dito con rotazione e scala.
        onDrag: (self) => {
          const card = currentItem();
          if (!card || deckAnimating.current) return;
          const dy = (self.y ?? 0) - (self.startY ?? 0);
          const dx = (self.x ?? 0) - (self.startX ?? 0);
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
          gsap.set(card, {
            y: dy * 0.55,
            rotation: gsap.utils.clamp(-8, 8, dx * 0.025),
            scale: 1 - Math.min(Math.abs(dy) / 1800, 0.07),
          });
        },
        // Se il gesto non ha superato la soglia, la card torna al suo posto con un rimbalzo elastico.
        onRelease: () => {
          latched = false;
          const card = currentItem();
          if (card && !deckAnimating.current) {
            gsap.to(card, { y: 0, rotation: 0, scale: 1, duration: 0.9, ease: "elastic.out(1, 0.55)", overwrite: "auto" });
          }
        },
      });
      return () => {
        observer.kill();
        grid.removeEventListener("click", swallowClickAfterDrag, true);
      };
    },
    { scope: gridRef, dependencies: [mode], revertOnUpdate: true },
  );

  // Se l'insieme di card cambia mentre si è nel Deck (nascondi, ricalcolo) si riallinea la pila.
  useGSAP(
    () => {
      if (modeRef.current !== "deck") return;
      const items = getItems();
      if (items.length === 0) return;
      deckIndexRef.current = Math.min(deckIndexRef.current, items.length - 1);
      layoutDeck(items, deckIndexRef.current, -1, true);
    },
    { scope: gridRef, dependencies: [visibleKey] },
  );

  // Tastiera e blocco dello scroll di pagina mentre il Deck è aperto.
  useEffect(() => {
    if (mode !== "deck") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // Con il drawer aperto la tastiera appartiene al drawer.
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "j") {
        event.preventDefault();
        gotoDeck(deckIndexRef.current + 1);
      } else if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "k") {
        event.preventDefault();
        gotoDeck(deckIndexRef.current - 1);
      } else if (event.key === "Escape") {
        switchMode("stream");
      }
    };
    window.addEventListener("keydown", onKey);
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = previous;
    };
  }, [mode, gotoDeck, switchMode]);

  /* ───────────── Ingresso a cascata e riordino con Flip ───────────── */

  useGSAP(
    () => {
      if (!ready || introDone) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          "[data-reveal]",
          { autoAlpha: 0, y: 24 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.6,
            ease: "power3.out",
            stagger: { amount: 0.9 },
            clearProps: "transform",
            onComplete: () => setIntroDone(true),
          },
        );
      });
      mm.add("(prefers-reduced-motion: reduce)", () => setIntroDone(true));
      return () => mm.revert();
    },
    { scope: gridRef, dependencies: [ready] },
  );

  useGSAP(
    () => {
      const state = flipState.current;
      if (!state) return;
      flipState.current = null;
      Flip.from(state, {
        duration: 0.8,
        ease: "power3.inOut",
        stagger: 0.012,
        onEnter: (elements) =>
          gsap.fromTo(
            elements,
            { autoAlpha: 0, scale: 0.9 },
            { autoAlpha: 1, scale: 1, duration: 0.5, delay: 0.25, ease: "power2.out" },
          ),
      });
    },
    { scope: gridRef, dependencies: [visibleKey] },
  );

  const badgeFor = (item: RankedPost): CardBadge => {
    const pv = vectors.get(item.post.id);
    if (item.slot === "archive") return { kind: "archive", year: publishedYear(item.post.publishedAt) };
    if (!pv) return { kind: "neutral" };
    if (item.slot === "frontier") {
      return { kind: "frontier", dimension: DIMENSION_META[DIMENSIONS[pv.topIndex]].short };
    }
    if (pv.confidence === 0) return { kind: "neutral" };
    return {
      kind: "match",
      percent: matchPercent(cosineSimilarity(profile.userVector, pv.vector)),
      dimension: DIMENSION_META[badgeDimension(profile.userVector, pv)].short,
    };
  };

  const slotCount = (slot: RankedPost["slot"]) => visible.filter((r) => r.slot === slot).length;
  const epsilonPercent = Math.round(profile.epsilon * 100);
  const deck = mode === "deck";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      <section aria-labelledby="feed-title" className="min-w-0">
        {/* Intestazione fissa: il selettore di vista resta a portata mentre si legge. */}
        <div className="sticky top-0 z-30 -mx-2 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line bg-obsidian/95 px-2 py-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="feed-title" className="text-lg font-semibold tracking-tight text-ink">
              Per te
            </h2>
            <p className="font-mono text-xs text-ink-mute">
              {visible.length} post · {slotCount("exploit")} exploit · {slotCount("frontier")} fuori bolla ·{" "}
              {slotCount("archive")} archivio · ε {epsilonPercent}%
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={recompute}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold outline-none transition",
                "focus-visible:ring-2 focus-visible:ring-emerald-cyber/70",
                dirty
                  ? "border-emerald-cyber/50 bg-emerald-cyber/15 text-emerald-cyber hover:bg-emerald-cyber/25"
                  : "border-line-strong text-ink-dim hover:text-ink",
              )}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Ricalcola Feed
              {dirty && <span aria-hidden className="size-1.5 rounded-full bg-emerald-cyber" />}
            </button>
            <button
              type="button"
              aria-pressed={translateTitles}
              onClick={() => setTranslateTitles(!translateTitles)}
              title={`Traduci i titoli del feed in ${lang.toUpperCase()}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold outline-none transition",
                "focus-visible:ring-2 focus-visible:ring-emerald-cyber/70",
                translateTitles
                  ? "border-indigo-pulse/50 bg-indigo-pulse/15 text-indigo-200"
                  : "border-line-strong text-ink-dim hover:text-ink",
              )}
            >
              {translated.status === "loading" ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <Languages aria-hidden className="size-3.5" />
              )}
              <span className="max-sm:sr-only">Traduci Titoli</span>
              <span className="uppercase">{lang}</span>
            </button>
            <ViewToggle mode={mode} onChange={switchMode} disabled={!introDone || visible.length === 0} />
          </div>
        </div>

        {translateTitles && translated.status === "unavailable" && (
          <p role="status" className="-mt-1 mb-3 rounded-lg border border-amber-glow/30 bg-amber-glow/5 px-3 py-2 font-mono text-[11px] text-amber-glow">
            Traduzione dei titoli non disponibile: {translated.notice}
          </p>
        )}
        {translateTitles && translated.status === "ready" && translated.notice && (
          <p role="status" className="-mt-1 mb-3 font-mono text-[11px] text-ink-mute">
            {translated.notice}
          </p>
        )}

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <div ref={wrapperRef}>
          {visible.length === 0 ? (
            <p className="rounded-xl border border-line bg-obsidian-card p-6 font-mono text-sm text-ink-dim">
              Hai nascosto tutti i post. Usa &ldquo;Reset&rdquo; nel pannello radar per ripartire.
            </p>
          ) : (
            <ul
              ref={gridRef}
              aria-label={deck ? "Feed a schede" : "Feed personalizzato"}
              className={cn(
                "list-none",
                deck
                  ? "fixed inset-0 z-40 m-0 touch-none select-none overflow-hidden overscroll-contain bg-obsidian p-0"
                  : "grid gap-4 md:grid-cols-2",
              )}
            >
              {visible.map((item) => {
                const badge = badgeFor(item);
                return (
                  <li
                    key={item.post.id}
                    data-flip-id={item.post.id}
                    className={deck ? "absolute inset-0 overflow-hidden bg-obsidian will-change-transform" : "h-full"}
                    style={
                      deck
                        ? { backgroundImage: `radial-gradient(70% 55% at 50% 0%, ${DECK_GLOW[badge.kind]}, transparent 70%)` }
                        : undefined
                    }
                  >
                    <PostCard
                      post={item.post}
                      referenceIso={fetchedAt}
                      badge={badge}
                      liked={liked.has(item.post.id)}
                      bookmarked={bookmarked.has(item.post.id)}
                      reveal={!introDone}
                      variant={deck ? "deck" : "stream"}
                      displayTitle={translated.titles[item.post.id]}
                      onInspect={handleInspect}
                      onLike={handleLike}
                      onBookmark={handleBookmark}
                      onHide={handleHide}
                      onRead={handleRead}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {deck && visible.length > 0 && (
          <>
            <div className="pointer-events-none fixed inset-x-0 top-0 z-[45] flex items-center justify-between gap-3 p-4 sm:p-6">
              <p className="pointer-events-auto font-mono text-xs text-ink-dim" aria-live="polite">
                <span className="font-semibold text-ink">Deck</span> · {safeDeckIndex + 1} / {visible.length}
              </p>
              <div className="pointer-events-auto flex items-center gap-2">
                <ViewToggle mode={mode} onChange={switchMode} />
                <button
                  type="button"
                  onClick={() => switchMode("stream")}
                  aria-label="Esci dal Deck"
                  className="grid size-9 place-items-center rounded-lg border border-line-strong bg-obsidian-card text-ink-dim outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            </div>

            <div className="pointer-events-none fixed bottom-14 right-4 z-[45] flex gap-2 sm:bottom-auto sm:right-6 sm:top-1/2 sm:-translate-y-1/2 sm:flex-col">
              {[
                { label: "Card precedente", delta: -1, Icon: ChevronUp, disabled: safeDeckIndex === 0 },
                { label: "Card successiva", delta: 1, Icon: ChevronDown, disabled: safeDeckIndex === visible.length - 1 },
              ].map(({ label, delta, Icon, disabled }) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  disabled={disabled}
                  onClick={() => gotoDeck(deckIndexRef.current + delta)}
                  className="pointer-events-auto grid size-11 place-items-center rounded-full border border-line-strong bg-obsidian-card/80 text-ink outline-none backdrop-blur transition hover:bg-obsidian-raised focus-visible:ring-2 focus-visible:ring-emerald-cyber/70 disabled:opacity-30"
                >
                  <Icon aria-hidden className="size-5" />
                </button>
              ))}
            </div>

            <p className="pointer-events-none fixed inset-x-0 bottom-4 z-[45] text-center font-mono text-[11px] text-ink-mute">
              Scorri o trascina ↑ ↓<span className="max-sm:hidden"> · tasti ↑ ↓ · Esc per uscire</span>
            </p>
          </>
        )}
      </section>

      {inspect && <ArticleDrawer key={inspect.id} post={inspect} onClose={closeInspect} />}

      <VectorRadar
        user={profile.userVector}
        epsilon={profile.epsilon}
        dirty={dirty}
        counts={{
          liked: profile.liked.length,
          bookmarked: profile.bookmarked.length,
          read: profile.read.length,
          hidden: profile.hidden.length,
        }}
        open={radarOpen}
        onClose={() => setRadarOpen(false)}
        onEpsilonChange={handleEpsilon}
        onOverride={handleOverride}
        onRecalculate={recompute}
        onReset={handleReset}
      />

      <button
        type="button"
        onClick={() => setRadarOpen(true)}
        className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full border border-emerald-cyber/40 bg-obsidian-card px-4 py-2.5 font-mono text-xs font-semibold text-emerald-cyber shadow-lg shadow-black/50 outline-none focus-visible:ring-2 focus-visible:ring-emerald-cyber/70 lg:hidden"
      >
        <Radar aria-hidden className="size-4" />
        Radar
        {dirty && <span aria-hidden className="size-1.5 rounded-full bg-emerald-cyber" />}
      </button>
    </div>
  );
}
