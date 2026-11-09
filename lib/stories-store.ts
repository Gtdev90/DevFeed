import { get, set } from "idb-keyval";
import { parseFollowInput } from "./stories-core";

const STORIES_KEY = "pulse:stories:v1";
const LOAD_TIMEOUT_MS = 1500;
/** Limite agli ID ricordati: oltre, si scartano i più vecchi. */
const MAX_VIEWED = 500;

/** Stato delle storie persistito in IndexedDB. */
export interface StoriesState {
  version: 1;
  /** ID delle storie già viste (`viewedStoryIds`), dalla più vecchia alla più recente. */
  viewedStoryIds: string[];
  /** Fonti seguite dall'utente oltre ai preset (`hn:<user>` / `domain:<host>`). */
  following: string[];
}

export function createDefaultStoriesState(): StoriesState {
  return { version: 1, viewedStoryIds: [], following: [] };
}

function parseState(value: unknown): StoriesState {
  const fallback = createDefaultStoriesState();
  if (typeof value !== "object" || value === null) return fallback;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return fallback;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

  // Le fonti seguite vengono rivalidate: un valore corrotto non deve arrivare all'API.
  const following = strings(raw.following).filter((id) => {
    const parsed = parseFollowInput(id.replace(/^(hn|domain):/, ""));
    return parsed !== null && parsed.id === id;
  });
  return {
    version: 1,
    viewedStoryIds: strings(raw.viewedStoryIds).slice(-MAX_VIEWED),
    following: [...new Set(following)],
  };
}

/** Carica lo stato; non lancia mai (storage non disponibile → stato vuoto). */
export async function loadStoriesState(): Promise<StoriesState> {
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS));
  try {
    return parseState(await Promise.race([get<unknown>(STORIES_KEY), timeout]));
  } catch {
    return createDefaultStoriesState();
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** Salva lo stato subito; le scritture sono serializzate. `false` se lo storage non è disponibile. */
export function saveStoriesState(state: StoriesState): Promise<boolean> {
  const next = writeQueue.then(async () => {
    try {
      await set(STORIES_KEY, { ...state, viewedStoryIds: state.viewedStoryIds.slice(-MAX_VIEWED) });
      return true;
    } catch {
      return false;
    }
  });
  writeQueue = next;
  return next;
}
