import { get, set, del } from "idb-keyval";
import {
  DEFAULT_EPSILON,
  clampEpsilon,
  isValidVector,
  normalize,
  uniformVector,
} from "./algorithm";

const PROFILE_KEY = "pulse:profile:v1";
/** Oltre questo tempo si prosegue con il profilo di default (IndexedDB bloccato o lento). */
const LOAD_TIMEOUT_MS = 1500;

/** Profilo di gusto dell'utente, persistito in IndexedDB. */
export interface Profile {
  version: 1;
  /** Lo user vector U, a lunghezza unitaria. */
  userVector: number[];
  /** Tasso di serendipità (quota explore) in [0.05, 0.5]. */
  epsilon: number;
  liked: string[];
  bookmarked: string[];
  read: string[];
  hidden: string[];
  updatedAt: string;
}

export function createDefaultProfile(): Profile {
  return {
    version: 1,
    userVector: [...uniformVector()],
    epsilon: DEFAULT_EPSILON,
    liked: [],
    bookmarked: [],
    read: [],
    hidden: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

/** Valida ciò che arriva dallo storage: dati corrotti o di altre versioni → default. */
function parseProfile(value: unknown): Profile {
  const fallback = createDefaultProfile();
  if (typeof value !== "object" || value === null) return fallback;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !isValidVector(raw.userVector)) return fallback;
  return {
    version: 1,
    userVector: [...normalize(raw.userVector)],
    epsilon: typeof raw.epsilon === "number" ? clampEpsilon(raw.epsilon) : DEFAULT_EPSILON,
    liked: stringArray(raw.liked),
    bookmarked: stringArray(raw.bookmarked),
    read: stringArray(raw.read),
    hidden: stringArray(raw.hidden),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : fallback.updatedAt,
  };
}

/** Carica il profilo; non lancia mai (storage non disponibile → profilo di default). */
export async function loadProfile(): Promise<Profile> {
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS));
  try {
    const stored = await Promise.race([get<unknown>(PROFILE_KEY), timeout]);
    return parseProfile(stored);
  } catch {
    return createDefaultProfile();
  }
}

// Le scritture sono serializzate: l'ultimo stato inviato è sempre l'ultimo scritto.
let writeQueue: Promise<unknown> = Promise.resolve();

/** Salva il profilo subito dopo ogni modifica. Restituisce `false` se lo storage non è disponibile. */
export function saveProfile(profile: Profile): Promise<boolean> {
  const next = writeQueue.then(async () => {
    try {
      await set(PROFILE_KEY, { ...profile, updatedAt: new Date().toISOString() });
      return true;
    } catch {
      return false;
    }
  });
  writeQueue = next;
  return next;
}

export async function clearProfile(): Promise<void> {
  writeQueue = writeQueue.then(() => del(PROFILE_KEY).catch(() => undefined));
  await writeQueue;
}
