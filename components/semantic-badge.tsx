import { Landmark, Target, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export type CardBadge =
  /** Exploit: affinità coseno con il profilo (verde). */
  | { kind: "match"; percent: number; dimension: string }
  /** Exploit senza segnali tematici riconoscibili: nessuna affinità da dichiarare. */
  | { kind: "neutral" }
  /** Explore: post contemporaneo fuori bolla, alto consenso (oro). */
  | { kind: "frontier"; dimension: string }
  /** Explore: perla dell'archivio storico (viola). */
  | { kind: "archive"; year: number };

const BASE =
  "inline-flex max-w-full items-center self-start gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] font-medium leading-none";

export function SemanticBadge({ badge }: { badge: CardBadge }) {
  switch (badge.kind) {
    case "match":
      return (
        <span
          className={cn(BASE, "border-emerald-cyber/30 bg-emerald-cyber/10 text-emerald-cyber")}
        >
          <Target aria-hidden className="size-3 shrink-0" />
          <span className="truncate">
            Match {badge.percent}% • {badge.dimension}
          </span>
        </span>
      );
    case "frontier":
      return (
        <span className={cn(BASE, "border-amber-glow/40 bg-amber-glow/10 text-amber-glow")}>
          <Zap aria-hidden className="size-3 shrink-0" />
          <span className="truncate">Scoperta Fuori Bolla • {badge.dimension}</span>
        </span>
      );
    case "archive":
      return (
        <span
          className={cn(BASE, "border-violet-archive/40 bg-violet-archive/10 text-violet-300")}
        >
          <Landmark aria-hidden className="size-3 shrink-0" />
          <span className="truncate">Archivio Storico ({badge.year})</span>
        </span>
      );
    case "neutral":
      return (
        <span className={cn(BASE, "border-line bg-white/[0.03] text-ink-mute")}>
          <Target aria-hidden className="size-3 shrink-0" />
          <span className="truncate">Generalista</span>
        </span>
      );
  }
}
