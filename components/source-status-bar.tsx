import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { SourceStatus } from "@/types/feed";
import { cn } from "@/lib/utils";

/** Riga di stato con l'esito reale di ciascuna fonte interrogata. */
export function SourceStatusBar({ sources }: { sources: SourceStatus[] }) {
  return (
    <ul
      aria-label="Stato delle fonti"
      className="flex list-none flex-wrap gap-2 font-mono text-xs"
    >
      {sources.map((source) => (
        <li
          key={source.id}
          title={source.ok ? `${source.count} post` : source.error}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1",
            source.ok
              ? "border-line bg-obsidian-card text-ink-dim"
              : "border-amber-glow/40 bg-amber-glow/10 text-amber-glow",
          )}
        >
          {source.ok ? (
            <CheckCircle2 aria-hidden className="size-3.5 text-emerald-cyber" />
          ) : (
            <AlertTriangle aria-hidden className="size-3.5" />
          )}
          <span>{source.label}</span>
          <span className="text-ink-mute">{source.ok ? source.count : "offline"}</span>
        </li>
      ))}
    </ul>
  );
}
