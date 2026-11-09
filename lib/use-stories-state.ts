import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createDefaultStoriesState,
  loadStoriesState,
  saveStoriesState,
  type StoriesState,
} from "./stories-store";

/**
 * Stato persistente delle storie: ID visti e fonti seguite.
 * `loaded` diventa true solo dopo la lettura da IndexedDB, così l'interfaccia non
 * mostra per un istante anelli "non letti" per storie in realtà già viste.
 */
export function useStoriesState() {
  const [state, setState] = useState<StoriesState>(createDefaultStoriesState);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadStoriesState().then((s) => {
      if (cancelled) return;
      setState(s);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded) void saveStoriesState(state);
  }, [state, loaded]);

  const viewed = useMemo(() => new Set(state.viewedStoryIds), [state.viewedStoryIds]);

  const markViewed = useCallback((storyId: string) => {
    setState((prev) =>
      prev.viewedStoryIds.includes(storyId)
        ? prev
        : { ...prev, viewedStoryIds: [...prev.viewedStoryIds, storyId] },
    );
  }, []);

  const follow = useCallback((id: string) => {
    setState((prev) => (prev.following.includes(id) ? prev : { ...prev, following: [...prev.following, id] }));
  }, []);

  const unfollow = useCallback((id: string) => {
    setState((prev) => ({ ...prev, following: prev.following.filter((f) => f !== id) }));
  }, []);

  return { loaded, viewed, following: state.following, markViewed, follow, unfollow };
}
