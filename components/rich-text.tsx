import { cn } from "@/lib/utils";

/**
 * Rende testo semplice con paragrafi, titoli (`## `) e blocchi di codice racchiusi tra ```.
 * Il contenuto è sempre trattato come testo (React lo escapa): nessun HTML dalla fonte o
 * dall'AI viene mai interpretato.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split("```");
  return (
    <div className={cn("space-y-4", className)}>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          // Segmento di codice: si scarta l'eventuale nome del linguaggio sulla prima riga.
          const code = part.replace(/^[a-z0-9+#-]{1,12}\n/i, "").replace(/^\n+|\s+$/g, "");
          if (!code) return null;
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg border border-line bg-black/40 p-4 font-mono text-[13px] leading-relaxed text-emerald-200"
            >
              <code>{code}</code>
            </pre>
          );
        }
        return part
          .split(/\n{2,}/)
          .map((block) => block.trim())
          .filter(Boolean)
          .map((block, j) =>
            block.startsWith("## ") ? (
              <h3 key={`${i}-${j}`} className="pt-2 text-base font-semibold text-ink">
                {block.slice(3)}
              </h3>
            ) : (
              <p key={`${i}-${j}`} className="whitespace-pre-line leading-relaxed text-ink-dim">
                {block}
              </p>
            ),
          );
      })}
    </div>
  );
}
