import type { SourceType } from "@/types/feed";
import { cn } from "@/lib/utils";

const SOURCE_STYLES: Record<SourceType, { label: string; className: string }> = {
  hacker_news: {
    label: "HN",
    className: "border-amber-glow/30 bg-amber-glow/10 text-amber-glow",
  },
  lobsters: {
    label: "Lobsters",
    className: "border-emerald-cyber/30 bg-emerald-cyber/10 text-emerald-cyber",
  },
  reddit: {
    label: "Reddit",
    className: "border-indigo-pulse/40 bg-indigo-pulse/10 text-indigo-300",
  },
  author_rss: {
    label: "RSS",
    className: "border-line-strong bg-white/5 text-ink-dim",
  },
};

export function sourceLabel(source: SourceType): string {
  return SOURCE_STYLES[source].label;
}

export function SourceBadge({ source, className }: { source: SourceType; className?: string }) {
  const style = SOURCE_STYLES[source];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider",
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}
