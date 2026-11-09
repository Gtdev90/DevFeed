"use client";

import { useState } from "react";
import type { StoryAuthor } from "@/types/stories";
import { cn } from "@/lib/utils";

function hueOf(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function initialsOf(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Avatar dell'autore: foto remota se disponibile, altrimenti monogramma colorato.
 * Il monogramma resta sempre sotto l'immagine, quindi non compaiono icone di immagine rotta.
 */
export function AuthorAvatar({
  author,
  size,
  className,
}: {
  author: StoryAuthor;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hue = hueOf(author.id);

  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue} 45% 24%), hsl(${(hue + 40) % 360} 50% 14%))`,
        color: `hsl(${hue} 80% 78%)`,
        fontSize: size * 0.34,
      }}
    >
      <span aria-hidden className="font-mono font-semibold">
        {initialsOf(author.name)}
      </span>
      {author.avatarUrl && !failed && (
        // Immagine remota non ottimizzabile da next/image: si ripiega sul monogramma se fallisce.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={author.avatarUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}
