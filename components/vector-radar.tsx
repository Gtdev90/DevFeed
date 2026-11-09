"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Minus, Plus, Radar, RefreshCw, RotateCcw, X } from "lucide-react";
import {
  DIMENSIONS,
  DIMENSION_META,
  EPSILON_MAX,
  EPSILON_MIN,
  type Vector,
} from "@/lib/algorithm";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Lato server si assume desktop (sidebar nel flusso): nessun drawer "inerte" all'SSR. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

const UNIFORM_SCALE = 1 / Math.sqrt(DIMENSIONS.length);

export interface VectorRadarProps {
  user: Vector;
  epsilon: number;
  /** true se il profilo è cambiato dopo l'ultimo ranking. */
  dirty: boolean;
  counts: { liked: number; bookmarked: number; read: number; hidden: number };
  /** Stato del drawer (solo mobile). */
  open: boolean;
  onClose: () => void;
  onEpsilonChange: (epsilon: number) => void;
  onOverride: (dimensionIndex: number, direction: 1 | -1) => void;
  onRecalculate: () => void;
  onReset: () => void;
}

/** Pannello "Live Vector Radar": sidebar su desktop, drawer su mobile. */
export function VectorRadar({
  user,
  epsilon,
  dirty,
  counts,
  open,
  onClose,
  onEpsilonChange,
  onOverride,
  onRecalculate,
  onReset,
}: VectorRadarProps) {
  const isDesktop = useIsDesktop();
  const panelRef = useRef<HTMLElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const previous = useRef<Vector | null>(null);

  const values = DIMENSIONS.map((_, i) => Math.min(1, Math.max(0, user[i])));
  const topIndex = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  const epsilonPercent = Math.round(epsilon * 100);

  // Barre animate: tween verso il nuovo valore + lampo sulle dimensioni che sono cambiate.
  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const before = previous.current;
      previous.current = user;
      barRefs.current.forEach((bar, i) => {
        if (!bar) return;
        const target = Math.min(1, Math.max(0, user[i]));
        if (!before || reduce) {
          gsap.set(bar, { scaleX: target });
          return;
        }
        gsap.to(bar, { scaleX: target, duration: 0.7, ease: "power3.out", overwrite: "auto" });
        if (Math.abs(user[i] - before[i]) > 0.004) {
          const row = rowRefs.current[i];
          if (row) {
            gsap.fromTo(
              row,
              { backgroundColor: "rgba(16,185,129,0.18)" },
              { backgroundColor: "rgba(16,185,129,0)", duration: 1, ease: "power2.out", overwrite: "auto" },
            );
          }
        }
      });
    },
    { dependencies: [user] },
  );

  // Drawer mobile: Esc per chiudere, focus sul pannello all'apertura.
  useEffect(() => {
    if (isDesktop || !open) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop, open, onClose]);

  const recalcButton = (
    <button
      type="button"
      onClick={onRecalculate}
      className={cn(
        "relative inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs font-semibold outline-none transition",
        "focus-visible:ring-2 focus-visible:ring-emerald-cyber/70",
        dirty
          ? "border-emerald-cyber/50 bg-emerald-cyber/15 text-emerald-cyber hover:bg-emerald-cyber/25"
          : "border-line-strong bg-white/[0.03] text-ink-dim hover:text-ink",
      )}
    >
      <RefreshCw aria-hidden className="size-3.5" />
      Ricalcola Feed
      {dirty && (
        <span
          title="Il profilo è cambiato dopo l'ultimo ordinamento"
          className="absolute right-3 size-2 rounded-full bg-emerald-cyber"
        />
      )}
    </button>
  );

  return (
    <>
      {!isDesktop && open && (
        <div
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        />
      )}
      <aside
        ref={panelRef}
        tabIndex={-1}
        inert={isDesktop ? undefined : !open}
        aria-label="Live Vector Radar"
        className={cn(
          "flex flex-col rounded-2xl border border-line bg-obsidian-card p-5 outline-none",
          // Desktop: sidebar sticky. Mobile: bottom sheet.
          "lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto",
          "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:max-h-[88dvh] max-lg:overflow-y-auto",
          "max-lg:rounded-b-none max-lg:border-b-0 max-lg:transition-transform max-lg:duration-300 max-lg:ease-out",
          !open && "max-lg:translate-y-full",
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
            <Radar aria-hidden className="size-4 text-emerald-cyber" />
            Live Vector Radar
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi il pannello"
            className="grid size-8 place-items-center rounded-md text-ink-dim outline-none hover:bg-white/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70 lg:hidden"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <p className="mb-4 font-mono text-[11px] leading-relaxed text-ink-mute max-lg:order-1">
          Il tuo vettore di gusto a 12 dimensioni. Si aggiorna a ogni like, segnalibro, lettura
          o post nascosto.
        </p>

        <ul className="mb-5 list-none space-y-0.5 max-lg:order-4" aria-label="Intensità delle 12 dimensioni">
          {DIMENSIONS.map((dimension, i) => {
            const meta = DIMENSION_META[dimension];
            const isTop = i === topIndex && values[i] > UNIFORM_SCALE + 0.02;
            return (
              <li
                key={dimension}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className="group/row rounded-md px-1.5 py-0.5"
              >
                <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className={cn("truncate", isTop ? "text-emerald-cyber" : "text-ink-dim")} title={meta.hint}>
                    {meta.short}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="w-7 text-right tabular-nums text-ink-mute">
                      {Math.round(values[i] * 100)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Diminuisci ${meta.short}`}
                      title={`Diminuisci ${meta.short}`}
                      onClick={() => onOverride(i, -1)}
                      className="grid size-5 place-items-center rounded border border-line text-ink-mute outline-none transition hover:border-line-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
                    >
                      <Minus aria-hidden className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Aumenta ${meta.short}`}
                      title={`Aumenta ${meta.short}`}
                      onClick={() => onOverride(i, 1)}
                      className="grid size-5 place-items-center rounded border border-line text-ink-mute outline-none transition hover:border-emerald-cyber/50 hover:text-emerald-cyber focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
                    >
                      <Plus aria-hidden className="size-3" />
                    </button>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <span
                    ref={(el) => {
                      barRefs.current[i] = el;
                    }}
                    // Valore costante: lo scale vero è gestito da GSAP, React non lo deve toccare.
                    style={{ transform: `scaleX(${UNIFORM_SCALE})` }}
                    className={cn(
                      "block h-full origin-left rounded-full",
                      isTop ? "bg-emerald-cyber" : "bg-indigo-pulse",
                    )}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mb-3 space-y-2 rounded-xl border border-line bg-obsidian p-3 max-lg:order-2 lg:mb-5">
          <label
            htmlFor="epsilon"
            className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-ink-dim"
          >
            <span>Tasso di Serendipità (Epsilon)</span>
            <output htmlFor="epsilon" className="text-sm font-semibold text-amber-glow">
              {epsilonPercent}%
            </output>
          </label>
          <input
            id="epsilon"
            type="range"
            className="epsilon w-full"
            min={EPSILON_MIN * 100}
            max={EPSILON_MAX * 100}
            step={1}
            value={epsilonPercent}
            onChange={(e) => onEpsilonChange(Number(e.target.value) / 100)}
            aria-valuetext={`${epsilonPercent}% explore, ${100 - epsilonPercent}% exploit`}
          />
          <p className="font-mono text-[11px] text-ink-mute">
            {100 - epsilonPercent}% Exploit · {epsilonPercent}% Explore
          </p>
        </div>

        <div className="max-lg:order-3 max-lg:mb-5">{recalcButton}</div>

        <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-ink-mute max-lg:order-5 lg:mt-4">
          <p>
            {counts.liked} like · {counts.bookmarked} salvati · {counts.read} letti ·{" "}
            {counts.hidden} nascosti
          </p>
          <button
            type="button"
            onClick={onReset}
            title="Azzera il profilo di gusto"
            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
          >
            <RotateCcw aria-hidden className="size-3" />
            Reset
          </button>
        </div>
      </aside>
    </>
  );
}
