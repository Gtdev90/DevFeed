"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

/**
 * Anello attorno all'avatar.
 *  - `unread`: gradiente ciano-indaco che ruota e pulsa in continuo (GSAP).
 *  - altrimenti: anello grigio tenue e fermo.
 */
export function StoryRing({
  unread,
  size,
  frozen = false,
  children,
}: {
  unread: boolean;
  size: number;
  /** true mentre il viewer è aperto: niente animazioni sotto il blur, per non ricalcolarlo a ogni frame. */
  frozen?: boolean;
  children: React.ReactNode;
}) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const spinner = useRef<HTMLSpanElement>(null);
  const glow = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (!unread || frozen) {
        gsap.set(wrapper.current, { scale: 1 });
        return;
      }
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.to(spinner.current, { rotation: 360, duration: 4, ease: "none", repeat: -1 });
        gsap.to(wrapper.current, { scale: 1.07, duration: 0.9, ease: "sine.inOut", yoyo: true, repeat: -1 });
        gsap.fromTo(
          glow.current,
          { opacity: 0.2 },
          { opacity: 0.75, duration: 0.9, ease: "sine.inOut", yoyo: true, repeat: -1 },
        );
      });
      return () => mm.revert();
    },
    // revertOnUpdate: al passaggio a "letto" le animazioni infinite devono fermarsi davvero.
    { dependencies: [unread, frozen], scope: wrapper, revertOnUpdate: true },
  );

  const outer = size + 10;
  return (
    <span ref={wrapper} className="relative inline-grid place-items-center" style={{ width: outer, height: outer }}>
      <span
        ref={glow}
        aria-hidden
        className={cn("absolute -inset-1 rounded-full blur-md", unread ? "opacity-30" : "opacity-0")}
        style={{ background: "linear-gradient(135deg, #22d3ee, #6366f1)" }}
      />
      <span
        ref={spinner}
        aria-hidden
        data-ring={unread ? "unread" : "read"}
        className="absolute inset-0 rounded-full"
        style={{
          background: unread
            ? "conic-gradient(from 0deg, #22d3ee, #6366f1, #22d3ee)"
            : "rgba(255,255,255,0.14)",
        }}
      />
      <span className="relative rounded-full bg-obsidian p-[3px]">{children}</span>
    </span>
  );
}
