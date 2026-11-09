import { GalleryVerticalEnd, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "stream" | "deck";

const OPTIONS: { mode: ViewMode; label: string; hint: string; Icon: typeof Rows3 }[] = [
  { mode: "stream", label: "Stream", hint: "Lista continua", Icon: Rows3 },
  { mode: "deck", label: "Deck", hint: "Card a schermo intero", Icon: GalleryVerticalEnd },
];

/** Selettore di vista: Stream (lista) o Deck / Reel (schermo intero). */
export function ViewToggle({
  mode,
  onChange,
  disabled,
  className,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Modalità di visualizzazione"
      className={cn("inline-flex rounded-lg border border-line-strong bg-obsidian-card p-0.5", className)}
    >
      {OPTIONS.map(({ mode: value, label, hint, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            title={hint}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold outline-none transition",
              "focus-visible:ring-2 focus-visible:ring-emerald-cyber/70 disabled:opacity-50",
              active ? "bg-emerald-cyber/15 text-emerald-cyber" : "text-ink-dim hover:text-ink",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
