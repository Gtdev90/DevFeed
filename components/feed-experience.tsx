"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";
import { Radar, RefreshCw } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { PostCard } from "./post-card";
import type { CardBadge } from "./semantic-badge";
import { VectorRadar } from "./vector-radar";

gsap.registerPlugin(useGSAP, Flip);

/** Attesa prima di riordinare dopo un cambio di preferenze (raggruppa click ravvicinati). */
const PREFERENCE_DEBOUNCE_MS = 300;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface FeedExperienceProps {
  posts: TechPost[];
  /** Istante in cui il feed è stato composto: riferimento per decay e date relative. */
  fetchedAt: string;
}

/**
 * Feed personalizzato: ranking epsilon-greedy, azioni (like / segnalibro / nascondi),
 * profilo persistito in IndexedDB e pannello Live Vector Radar.
 *
 * Le percentuali di affinità si aggiornano subito a ogni interazione; l'ordine delle
 * card cambia solo su "Ricalcola Feed" o al cambio di preferenze (slider ε, override),
 * così le card non "scappano" da sotto il cursore.
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

  const { profile, ready, interact, override, setEpsilon, reset } = useTasteProfile({
    onLoaded: (loaded) => setRanking(rank(loaded.userVector, loaded.epsilon)),
  });

  const gridRef = useRef<HTMLUListElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const profileRef = useRef(profile);
  const visibleKeyRef = useRef("");
  const debounceTimer = useRef<number | undefined>(undefined);
  const leaving = useRef(new Set<string>());

  const hidden = useMemo(() => new Set(profile.hidden), [profile.hidden]);
  const visible = useMemo(() => ranking.filter((r) => !hidden.has(r.post.id)), [ranking, hidden]);
  const visibleKey = visible.map((r) => r.post.id).join("|");

  useEffect(() => {
    profileRef.current = profile;
    visibleKeyRef.current = visibleKey;
  });
  useEffect(() => () => window.clearTimeout(debounceTimer.current), []);

  const liked = useMemo(() => new Set(profile.liked), [profile.liked]);
  const bookmarked = useMemo(() => new Set(profile.bookmarked), [profile.bookmarked]);

  /** Fotografa le posizioni attuali delle card: va chiamata PRIMA del cambio di stato. */
  const captureFlip = useCallback(() => {
    const grid = gridRef.current;
    flipState.current =
      grid && !prefersReducedMotion() ? Flip.getState(grid.querySelectorAll("[data-flip-id]")) : null;
  }, []);

  const recompute = useCallback(() => {
    const { userVector, epsilon, hidden: hiddenIds } = profileRef.current;
    const next = rank(userVector, epsilon);
    const hiddenSet = new Set(hiddenIds);
    const nextKey = next
      .filter((r) => !hiddenSet.has(r.post.id))
      .map((r) => r.post.id)
      .join("|");
    if (nextKey !== visibleKeyRef.current) captureFlip();
    setRanking(next);
    setDirty(false);
    setAnnouncement(`Feed ricalcolato: ${nextKey ? nextKey.split("|").length : 0} post.`);
  }, [rank, captureFlip]);

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
    setRanking(rank(fresh.userVector, fresh.epsilon));
    setDirty(false);
    setAnnouncement("Profilo azzerato.");
  }, [reset, rank, captureFlip]);

  // Ingresso a cascata, una sola volta, appena il profilo è caricato.
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

  // Riposizionamento fluido con GSAP Flip ogni volta che cambia l'insieme/ordine visibile.
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

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      <section aria-labelledby="feed-title" className="min-w-0">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="feed-title" className="text-lg font-semibold tracking-tight text-ink">
              Per te
            </h2>
            <p className="font-mono text-xs text-ink-mute">
              {visible.length} post · {slotCount("exploit")} exploit · {slotCount("frontier")} fuori bolla ·{" "}
              {slotCount("archive")} archivio · ε {epsilonPercent}%
            </p>
          </div>
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
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {visible.length === 0 ? (
          <p className="rounded-xl border border-line bg-obsidian-card p-6 font-mono text-sm text-ink-dim">
            Hai nascosto tutti i post. Usa &ldquo;Reset&rdquo; nel pannello radar per ripartire.
          </p>
        ) : (
          <ul ref={gridRef} aria-label="Feed personalizzato" className="grid list-none gap-4 md:grid-cols-2">
            {visible.map((item) => (
              <li key={item.post.id} data-flip-id={item.post.id} className="h-full">
                <PostCard
                  post={item.post}
                  referenceIso={fetchedAt}
                  badge={badgeFor(item)}
                  liked={liked.has(item.post.id)}
                  bookmarked={bookmarked.has(item.post.id)}
                  reveal={!introDone}
                  onLike={handleLike}
                  onBookmark={handleBookmark}
                  onHide={handleHide}
                  onRead={handleRead}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

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
