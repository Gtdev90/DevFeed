"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { TechPost } from "@/types/feed";
import { PostCard } from "./post-card";

gsap.registerPlugin(useGSAP);

interface FeedListProps {
  posts: TechPost[];
  referenceIso: string;
  /** Etichetta accessibile della lista. */
  label: string;
  /** Ritardo (secondi) prima dell'ingresso, per scaglionare più liste nella stessa pagina. */
  delay?: number;
}

/** Griglia di card con ingresso a cascata (stagger) via GSAP. */
export function FeedList({ posts, referenceIso, label, delay = 0 }: FeedListProps) {
  const container = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          "[data-reveal]",
          { autoAlpha: 0, y: 24 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.6,
            delay,
            ease: "power3.out",
            // Durata complessiva dello stagger costante, qualunque sia il numero di card.
            stagger: { amount: 0.9 },
            // Libera il transform a fine animazione, così l'hover CSS torna a funzionare.
            clearProps: "transform",
          },
        );
      });
      return () => mm.revert();
    },
    { scope: container, dependencies: [posts] },
  );

  return (
    <div ref={container}>
      <ul aria-label={label} className="grid list-none gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {posts.map((post) => (
          <li key={post.id} className="h-full">
            <PostCard post={post} referenceIso={referenceIso} />
          </li>
        ))}
      </ul>
    </div>
  );
}
