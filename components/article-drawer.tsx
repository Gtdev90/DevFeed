"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { Observer } from "gsap/Observer";
import { useGSAP } from "@gsap/react";
import {
  AlertTriangle,
  Bookmark,
  ExternalLink,
  Info,
  Loader2,
  MessageSquare,
  Quote,
  RefreshCw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type { TechPost } from "@/types/feed";
import { LANGS, LANG_META, isLang } from "@/lib/ai/lang";
import { useArticleInsight } from "@/lib/use-article-insight";
import { cn } from "@/lib/utils";
import { usePrefs } from "./prefs-provider";
import { RichText } from "./rich-text";
import { SourceBadge } from "./source-badge";

gsap.registerPlugin(useGSAP, Observer);

type Tab = "summary" | "original";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Skeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-5">
      <p className="inline-flex items-center gap-2 font-mono text-xs text-emerald-cyber">
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
        {label}
      </p>
      {[100, 92, 76].map((w) => (
        <div key={w} className="h-4 animate-pulse rounded bg-obsidian-card" style={{ width: `${w}%` }} />
      ))}
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-line bg-obsidian-card" />
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
      {icon}
      {children}
    </h3>
  );
}

interface ArticleDrawerProps {
  post: TechPost;
  onClose: () => void;
}

/**
 * Drawer a tutto schermo con sintesi AI tradotta e fonte originale (articolo + commenti).
 * Si apre dal basso con GSAP; il toggle in cima scambia i due contenuti con fade e blur.
 */
export function ArticleDrawer({ post, onClose }: ArticleDrawerProps) {
  const { lang, setLang } = usePrefs();
  const insight = useArticleInsight(post, lang);
  const [tab, setTab] = useState<Tab>("summary");

  const rootRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const swappingRef = useRef(false);
  const mountedRef = useRef(false);
  const closeRef = useRef<() => void>(() => {});

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (reduced()) return onClose();
    gsap.to(backdropRef.current, { autoAlpha: 0, duration: 0.35 });
    gsap.to(sheetRef.current, { yPercent: 100, duration: 0.45, ease: "power3.in", onComplete: onClose });
  };
  useEffect(() => {
    closeRef.current = close;
  });

  // Apertura: il pannello sale dal basso fino a occupare tutto lo schermo.
  useGSAP(
    () => {
      gsap.set(rootRef.current, { autoAlpha: 1 });
      if (reduced()) return;
      gsap.fromTo(backdropRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 });
      gsap.fromTo(sheetRef.current, { yPercent: 100 }, { yPercent: 0, duration: 0.7, ease: "power4.out" });
    },
    { scope: rootRef },
  );

  // Trascinando l'intestazione verso il basso il drawer si chiude.
  useGSAP(
    () => {
      const header = headerRef.current;
      if (!header) return;
      const observer = Observer.create({
        target: header,
        type: "touch,pointer",
        tolerance: 70,
        ignore: "button, select, a",
        onDown: () => closeRef.current(),
      });
      return () => observer.kill();
    },
    { scope: rootRef },
  );

  // Esc, blocco dello scroll di pagina e focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    rootRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = previous;
    };
  }, []);

  // La scheda "Originale" carica articolo e commenti solo quando serve.
  const { loadContext } = insight;
  useEffect(() => {
    if (tab === "original") void loadContext();
  }, [tab, loadContext]);

  /* ───────────── Toggle con fade & blur ───────────── */

  const switchTab = (next: Tab) => {
    if (next === tab || swappingRef.current) return;
    const el = contentRef.current;
    if (!el || reduced()) {
      setTab(next);
      return;
    }
    swappingRef.current = true;
    gsap.to(el, {
      autoAlpha: 0,
      filter: "blur(10px)",
      y: -8,
      duration: 0.18,
      ease: "power1.in",
      onComplete: () => {
        setTab(next);
        scrollerRef.current?.scrollTo({ top: 0 });
      },
    });
  };

  useGSAP(
    () => {
      if (!mountedRef.current) {
        mountedRef.current = true;
        return;
      }
      const el = contentRef.current;
      if (!el || reduced()) {
        swappingRef.current = false;
        return;
      }
      gsap.fromTo(
        el,
        { autoAlpha: 0, filter: "blur(10px)", y: 10 },
        {
          autoAlpha: 1,
          filter: "blur(0px)",
          y: 0,
          duration: 0.32,
          ease: "power2.out",
          clearProps: "filter,transform",
          onComplete: () => {
            swappingRef.current = false;
          },
        },
      );
    },
    { scope: contentRef, dependencies: [tab] },
  );

  // Le sezioni compaiono a cascata quando i dati arrivano.
  const readyKey = tab === "summary" ? insight.analysisStatus : insight.contextStatus;
  useGSAP(
    () => {
      if (readyKey !== "ready" || reduced()) return;
      gsap.fromTo(
        "[data-sec]",
        { autoAlpha: 0, y: 14 },
        { autoAlpha: 1, y: 0, duration: 0.45, ease: "power2.out", stagger: 0.07, clearProps: "transform" },
      );
    },
    { scope: contentRef, dependencies: [readyKey, tab, lang] },
  );

  /* ───────────── Contenuti ───────────── */

  const host = (() => {
    try {
      return new URL(post.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const res = insight.analysis;
  const analysis = res?.analysis;
  const langCode = lang.toUpperCase();
  const headline = tab === "summary" && res?.mode === "ai" && analysis ? analysis.translatedTitle : post.title;

  const summary = (() => {
    if (insight.analysisStatus === "loading") return <Skeleton label="Analizzo articolo e discussione…" />;
    if (insight.analysisStatus === "error" || !analysis || !res) {
      return (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-glow/30 bg-amber-glow/5 p-5">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-glow" />
          <div className="space-y-3 text-sm">
            <p className="text-ink">Non sono riuscito a generare la sintesi.</p>
            <p className="font-mono text-xs text-ink-dim">{insight.analysisError}</p>
            <button
              type="button"
              onClick={() => void insight.regenerate()}
              className="rounded-lg border border-line-strong px-3 py-1.5 font-mono text-xs text-ink outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
            >
              Riprova
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-8">
        {res.notice && (
          <div data-sec role="note" className="flex items-start gap-3 rounded-xl border border-amber-glow/30 bg-amber-glow/5 p-4">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-glow" />
            <div className="space-y-1.5 text-sm text-ink-dim">
              <p>{res.notice.message}</p>
              {res.notice.code === "missing_key" && (
                <p className="font-mono text-xs text-ink-mute">
                  .env.local → <code className="rounded bg-white/5 px-1.5 py-0.5 text-amber-glow">OPENROUTER_API_KEY=sk-or-…</code>
                </p>
              )}
            </div>
          </div>
        )}

        <div data-sec className="space-y-3">
          <p className="text-lg leading-relaxed text-ink sm:text-xl">{analysis.hook}</p>
          {res.mode === "ai" && analysis.translatedTitle !== post.title && (
            <p className="font-mono text-xs text-ink-mute">Originale: {post.title}</p>
          )}
        </div>

        {analysis.threePillars.length > 0 && (
          <section data-sec aria-label="Tre pilastri tecnici">
            <SectionLabel icon={<Sparkles aria-hidden className="size-3.5 text-emerald-cyber" />}>Tre pilastri</SectionLabel>
            <ol className="grid list-none gap-3 sm:grid-cols-3">
              {analysis.threePillars.map((pillar, i) => (
                <li key={i} className="rounded-xl border border-line bg-obsidian-card p-4">
                  <span className="font-mono text-xs font-semibold text-emerald-cyber">0{i + 1}</span>
                  <p className="mt-2 text-sm leading-relaxed text-ink">{pillar}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {analysis.keySnippetOrConcept && (
          <section data-sec aria-label="Concetto chiave">
            <SectionLabel icon={<Bookmark aria-hidden className="size-3.5 text-indigo-300" />}>Concetto chiave</SectionLabel>
            <div className="rounded-xl border border-indigo-pulse/30 bg-indigo-pulse/5 p-4">
              <RichText text={analysis.keySnippetOrConcept} />
            </div>
          </section>
        )}

        <section data-sec aria-label="Consenso della community">
          <SectionLabel icon={<Quote aria-hidden className="size-3.5 text-amber-glow" />}>Consenso della community</SectionLabel>
          {analysis.communityConsensus ? (
            <div className="rounded-xl border border-amber-glow/20 bg-amber-glow/5 p-4">
              <RichText text={analysis.communityConsensus} />
            </div>
          ) : (
            <p className="text-sm text-ink-mute">Nessun commento disponibile per questo post.</p>
          )}
        </section>

        <footer data-sec className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 font-mono text-[11px] text-ink-mute">
          <p className="inline-flex items-center gap-1.5">
            {insight.fromCache ? (
              <>
                <Zap aria-hidden className="size-3 text-emerald-cyber" />
                Dalla cache locale · nessuna chiamata, nessun token
              </>
            ) : res.mode === "ai" ? (
              `Generata con ${res.model ?? "AI"}`
            ) : (
              "Estrazione automatica dal testo originale (senza AI)"
            )}
          </p>
          {res.mode === "ai" && (
            <button
              type="button"
              onClick={() => void insight.regenerate()}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
            >
              <RefreshCw aria-hidden className="size-3" />
              Rigenera
            </button>
          )}
        </footer>
      </div>
    );
  })();

  const original = (() => {
    const { context } = insight;
    if (insight.contextStatus === "loading" || (insight.contextStatus === "idle" && !context)) {
      return <Skeleton label="Recupero fonte e commenti…" />;
    }
    if (insight.contextStatus === "error" && !context) {
      return (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-glow/30 bg-amber-glow/5 p-5">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-glow" />
          <div className="space-y-3 text-sm">
            <p className="text-ink">Non sono riuscito a caricare fonte e commenti.</p>
            <p className="font-mono text-xs text-ink-dim">{insight.contextError}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void insight.loadContext()}
                className="rounded-lg border border-line-strong px-3 py-1.5 font-mono text-xs text-ink outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
              >
                Riprova
              </button>
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-line-strong px-3 py-1.5 font-mono text-xs text-ink-dim outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
              >
                Apri l&apos;originale
              </a>
            </div>
          </div>
        </div>
      );
    }
    if (!context) return null;
    const article = context.article;
    return (
      <div className="space-y-10">
        <section data-sec aria-label="Fonte">
          <SectionLabel icon={<ExternalLink aria-hidden className="size-3.5 text-emerald-cyber" />}>Fonte</SectionLabel>
          {article ? (
            <div className="space-y-4">
              <div className="space-y-1">
                {/* Il titolo dell'articolo si mostra solo se aggiunge informazione rispetto a quello del post. */}
                {article.title && article.title !== post.title && (
                  <h3 className="text-xl font-semibold text-ink">{article.title}</h3>
                )}
                <p className="font-mono text-xs text-ink-mute">
                  {[article.siteName ?? host, article.byline, `${article.wordCount} parole`].filter(Boolean).join(" · ")}
                  {article.truncated && " · testo troncato"}
                </p>
              </div>
              <RichText text={article.text} />
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-obsidian-card p-4 text-sm text-ink-dim">
              <p>Il testo dell&apos;articolo non è disponibile in-app{context.articleError ? ` (${context.articleError})` : ""}.</p>
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 font-mono text-xs text-emerald-cyber underline-offset-4 hover:underline"
              >
                <ExternalLink aria-hidden className="size-3.5" />
                Apri la fonte originale
              </a>
            </div>
          )}
        </section>

        <section data-sec aria-label="Commenti">
          <SectionLabel icon={<MessageSquare aria-hidden className="size-3.5 text-amber-glow" />}>
            Commenti ({context.comments.length})
          </SectionLabel>
          {context.comments.length === 0 ? (
            <p className="text-sm text-ink-mute">Nessun commento in questa discussione.</p>
          ) : (
            <ul className="list-none space-y-3">
              {context.comments.map((c) => (
                <li
                  key={c.id}
                  style={{ marginLeft: c.depth * 20 }}
                  className={cn("rounded-lg border bg-obsidian-card p-3.5", c.depth > 0 ? "border-line/60" : "border-line")}
                >
                  <p className="mb-1.5 font-mono text-[11px] text-ink-mute">
                    <span className="text-ink-dim">@{c.author}</span>
                    {c.score !== undefined && ` · ${c.score} punti`}
                  </p>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-ink-dim">{c.text}</p>
                </li>
              ))}
            </ul>
          )}
          <a
            href={context.discussionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2 font-mono text-xs text-ink-dim outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
          >
            <MessageSquare aria-hidden className="size-3.5" />
            Apri discussione completa
          </a>
        </section>
      </div>
    );
  })();

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      tabIndex={-1}
      className="invisible fixed inset-0 z-[90] opacity-0 outline-none"
    >
      <div ref={backdropRef} onClick={close} className="absolute inset-0 bg-black/70" />

      <div ref={sheetRef} className="absolute inset-0 flex flex-col bg-obsidian">
        <header ref={headerRef} className="shrink-0 border-b border-line bg-obsidian/95 px-4 pb-3 pt-3 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button
              type="button"
              onClick={close}
              aria-label="Chiudi"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong text-ink outline-none transition hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
            >
              <X aria-hidden className="size-4" />
            </button>
            <SourceBadge source={post.source} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-mute">{host}</span>
            <select
              value={lang}
              onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}
              aria-label="Lingua della sintesi"
              className="rounded-lg border border-line-strong bg-obsidian-card px-2 py-1.5 font-mono text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
            >
              {LANGS.map((code) => (
                <option key={code} value={code}>
                  {LANG_META[code].label}
                </option>
              ))}
            </select>
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Apri l'originale in una nuova scheda"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong text-ink-dim outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-emerald-cyber/70"
            >
              <ExternalLink aria-hidden className="size-4" />
            </a>
          </div>

          <div className="mx-auto mt-3 max-w-3xl">
            <div role="tablist" aria-label="Contenuto" className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-obsidian-card p-1">
              {(
                [
                  { id: "summary", label: `[${langCode}] Traduzione & Sintesi` },
                  { id: "original", label: "[Originale] Fonte & Commenti" },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls="drawer-panel"
                  onClick={() => switchTab(id)}
                  className={cn(
                    "rounded-lg px-3 py-2 font-mono text-xs font-semibold outline-none transition",
                    "focus-visible:ring-2 focus-visible:ring-emerald-cyber/70",
                    tab === id ? "bg-emerald-cyber/15 text-emerald-cyber" : "text-ink-dim hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div
            ref={contentRef}
            id="drawer-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6"
          >
            <h2 id="drawer-title" className="mb-6 text-balance text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
              {headline}
            </h2>
            {tab === "summary" ? summary : original}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
