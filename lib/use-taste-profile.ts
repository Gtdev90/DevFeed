import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyInteraction,
  applyOverride,
  clampEpsilon,
  type InteractionKind,
  type Vector,
} from "./algorithm";
import { clearProfile, createDefaultProfile, loadProfile, saveProfile, type Profile } from "./profile-store";

type Bucket = "liked" | "bookmarked" | "read" | "hidden";

const BUCKET_OF: Record<InteractionKind, Bucket> = {
  like: "liked",
  bookmark: "bookmarked",
  read: "read",
  skip: "hidden",
};

interface Options {
  /** Chiamata una volta, con il profilo caricato da IndexedDB (o quello di default). */
  onLoaded?: (profile: Profile) => void;
}

/**
 * Stato del profilo di gusto: carica da IndexedDB al mount, applica le interazioni
 * al vettore utente e salva su storage a ogni modifica.
 * Ogni interazione vale una sola volta per post (like/bookmark/lettura/skip).
 */
export function useTasteProfile({ onLoaded }: Options = {}) {
  const [profile, setProfile] = useState<Profile>(createDefaultProfile);
  const [ready, setReady] = useState(false);
  const onLoadedRef = useRef(onLoaded);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  useEffect(() => {
    let cancelled = false;
    void loadProfile().then((loaded) => {
      if (cancelled) return;
      setProfile(loaded);
      onLoadedRef.current?.(loaded);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Salvataggio immediato a ogni cambiamento (mai prima del caricamento, per non
  // sovrascrivere il profilo esistente con quello di default).
  useEffect(() => {
    if (ready) void saveProfile(profile);
  }, [profile, ready]);

  const interact = useCallback((kind: InteractionKind, postId: string, postVector: Vector) => {
    setProfile((prev) => {
      const bucket = BUCKET_OF[kind];
      if (prev[bucket].includes(postId)) return prev;
      return {
        ...prev,
        userVector: [...applyInteraction(prev.userVector, postVector, kind)],
        [bucket]: [...prev[bucket], postId],
      };
    });
  }, []);

  const override = useCallback((dimensionIndex: number, direction: 1 | -1) => {
    setProfile((prev) => ({
      ...prev,
      userVector: [...applyOverride(prev.userVector, dimensionIndex, direction)],
    }));
  }, []);

  const setEpsilon = useCallback((epsilon: number) => {
    setProfile((prev) => ({ ...prev, epsilon: clampEpsilon(epsilon) }));
  }, []);

  const reset = useCallback(() => {
    const fresh = createDefaultProfile();
    setProfile(fresh);
    void clearProfile();
    return fresh;
  }, []);

  return { profile, ready, interact, override, setEpsilon, reset };
}
