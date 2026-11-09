/**
 * Termini tecnici che NON vanno tradotti. Elenco passato al modello nel prompt e usato
 * come rete di sicurezza: se il modello traduce comunque un termine presente nella fonte,
 * `restoreTechnicalTerms` lo riporta all'originale.
 */
export const KEEP_TERMS: readonly string[] = [
  "pointer",
  "goroutine",
  "garbage collection",
  "race condition",
  "deadlock",
  "zero-copy",
  "mutex",
  "thread",
  "stack",
  "heap",
  "runtime",
  "framework",
  "callback",
  "closure",
  "cache",
  "kernel",
  "syscall",
  "buffer",
  "memory leak",
  "undefined behavior",
  "borrow checker",
  "lifetime",
  "lock-free",
  "backpressure",
  "sharding",
  "consensus",
  "bytecode",
  "hot path",
  "pull request",
  "open source",
  "embedding",
  "fine-tuning",
  "inference",
  "throughput",
  "latency",
];

interface Rule {
  /** Termine originale che deve comparire nella fonte perché la regola scatti. */
  term: string;
  /** Traduzioni "innaturali" osservate nei modelli da riportare al termine originale. */
  pattern: RegExp;
}

// Solo italiano: è la lingua di default e quella in cui i modelli traducono più spesso
// i termini consolidati ("condizione di gara", "raccolta dei rifiuti", "puntatore").
const IT_RULES: readonly Rule[] = [
  { term: "race condition", pattern: /\bcondizion(e|i) di (gara|competizione|corsa)\b|\bcorsa critica\b/gi },
  { term: "garbage collection", pattern: /\braccolta (dei|di) rifiuti\b|\bgarbage collector\b/gi },
  { term: "deadlock", pattern: /\bstallo (del|dei|dello|di)\b|\bblocco critico\b|\bimpasse\b/gi },
  { term: "zero-copy", pattern: /\bcopia[- ]zero\b|\bzero[- ]copia\b|\bzero copy\b/gi },
  { term: "pointer", pattern: /\bpuntator(e|i)\b/gi },
  { term: "goroutine", pattern: /\bgoroutin(a|e)\b|\bgo-routine\b/gi },
  { term: "mutex", pattern: /\bmutua esclusione\b/gi },
  { term: "memory leak", pattern: /\bperdit(a|e) di memoria\b/gi },
];

const IT_REPLACEMENT: Record<string, string> = {
  "race condition": "race condition",
  "garbage collection": "garbage collection",
  deadlock: "deadlock",
  "zero-copy": "zero-copy",
  pointer: "pointer",
  goroutine: "goroutine",
  mutex: "mutex",
  "memory leak": "memory leak",
};

const contains = (haystack: string, term: string) =>
  new RegExp(`(^|[^a-z0-9])${term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}($|[^a-z0-9])`, "i").test(haystack);

/**
 * Ripristina i termini tecnici che il modello ha tradotto a sproposito.
 * Agisce solo se il termine originale è davvero presente nel testo sorgente, per non
 * alterare frasi in cui "puntatore" o "stallo" hanno il loro significato comune.
 */
export function restoreTechnicalTerms(text: string, source: string, lang: string): string {
  if (lang !== "it" || !text) return text;
  let out = text;
  for (const rule of IT_RULES) {
    if (contains(source, rule.term)) out = out.replace(rule.pattern, IT_REPLACEMENT[rule.term]);
  }
  return out;
}
