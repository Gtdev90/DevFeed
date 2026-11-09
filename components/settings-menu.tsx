"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Check, Languages, Settings } from "lucide-react";
import { LANGS, LANG_META } from "@/lib/ai/lang";
import { cn } from "@/lib/utils";
import { usePrefs } from "./prefs-provider";

/** Impostazioni dell'app: lingua dei riassunti e traduzione dei titoli del feed. */
export function SettingsMenu() {
  const { lang, setLang, translateTitles, setTranslateTitles } = usePrefs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    if (panelRef.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.fromTo(panelRef.current, { autoAlpha: 0, y: -8, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.22, ease: "power3.out" });
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="settings-panel"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-obsidian-card px-3 py-1.5 font-mono text-xs text-ink-dim outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
      >
        <Settings aria-hidden className="size-3.5" />
        <span className="max-sm:sr-only">Impostazioni</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-emerald-cyber">{lang}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          id="settings-panel"
          role="dialog"
          aria-label="Impostazioni"
          className="invisible absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-line-strong bg-obsidian-card p-4 opacity-0 shadow-2xl shadow-black/60"
        >
          <fieldset className="space-y-1.5">
            <legend className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-ink-mute">
              <Languages aria-hidden className="size-3.5" />
              Lingua dei riassunti
            </legend>
            {LANGS.map((code) => {
              const active = code === lang;
              return (
                <label
                  key={code}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-cyber/70",
                    active ? "border-emerald-cyber/40 bg-emerald-cyber/10 text-ink" : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
                  )}
                >
                  <span>
                    {LANG_META[code].label}
                    {code === "it" && <span className="ml-2 font-mono text-[10px] text-ink-mute">predefinita</span>}
                  </span>
                  {active && <Check aria-hidden className="size-4 text-emerald-cyber" />}
                  <input
                    type="radio"
                    name="summary-lang"
                    value={code}
                    checked={active}
                    onChange={() => setLang(code)}
                    className="sr-only"
                  />
                </label>
              );
            })}
          </fieldset>

          <label className="mt-4 flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-line px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-cyber/70">
            <span className="text-sm text-ink">
              Titoli del feed tradotti
              <span className="mt-0.5 block font-mono text-[11px] leading-snug text-ink-mute">
                Richiede la chiave OpenRouter sul server.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={translateTitles}
              onChange={(e) => setTranslateTitles(e.target.checked)}
              className="mt-1 size-4 shrink-0 accent-emerald-500"
            />
          </label>
        </div>
      )}
    </div>
  );
}
