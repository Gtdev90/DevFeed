/**
 * Motore di raccomandazione di PULSE.DEV.
 *
 * - Spazio vettoriale a 12 dimensioni (tassonomia fissa, vedi `DIMENSIONS`).
 * - Vettorizzazione euristica dei post (keyword pesate + indizi su tag e dominio).
 * - Aggiornamento dello user vector (like / bookmark / lettura / skip).
 * - Ranking epsilon-greedy: exploit (cosine × community × decay) + explore
 *   (scoperte fuori bolla e perle d'archivio a cadenza regolare).
 *
 * Il modulo è puro e deterministico: nessun accesso a DOM, storage o Math.random.
 */
import type { TechPost } from "@/types/feed";

/* ───────────────────────────── Tassonomia ───────────────────────────── */

export const DIMENSIONS = [
  "Systems_LowLevel",
  "AI_ML",
  "Web_Frontend",
  "Backend_Scale",
  "Databases",
  "Security_Crypto",
  "Compilers_PL",
  "OpenSource_Culture",
  "DevOps_Infra",
  "Math_Algorithms",
  "Hardware_Embedded",
  "Career_Philosophy",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_COUNT = DIMENSIONS.length;

/** Vettore a 12 componenti, nell'ordine di `DIMENSIONS`. */
export type Vector = readonly number[];

export const DIMENSION_META: Record<Dimension, { short: string; hint: string }> = {
  Systems_LowLevel: { short: "Systems", hint: "C, Rust, Linux, kernel, memory, OS" },
  AI_ML: { short: "AI / ML", hint: "LLM, reti neurali, PyTorch, inferenza" },
  Web_Frontend: { short: "Frontend", hint: "React, Next.js, CSS, browser" },
  Backend_Scale: { short: "Backend", hint: "distribuzione, microservizi, Go, resilienza" },
  Databases: { short: "Databases", hint: "Postgres, Redis, SQL, storage engine" },
  Security_Crypto: { short: "Security", hint: "vulnerabilità, exploit, crittografia" },
  Compilers_PL: { short: "Compilers", hint: "linguaggi, AST, type system, parser" },
  OpenSource_Culture: { short: "Open Source", hint: "licenze, comunità, storia, governance" },
  DevOps_Infra: { short: "DevOps", hint: "Kubernetes, Docker, CI/CD, cloud, rete" },
  Math_Algorithms: { short: "Math & Algo", hint: "complessità, grafi, strutture dati" },
  Hardware_Embedded: { short: "Hardware", hint: "microcontrollori, FPGA, elettronica, IoT" },
  Career_Philosophy: { short: "Career", hint: "scrittura codice, etica, saggi, produttività" },
};

/* ───────────────────────── Operazioni sui vettori ───────────────────────── */

export function norm(v: Vector): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

/** Vettore bilanciato di lunghezza euclidea 1: ogni componente vale 1/√12. */
export function uniformVector(): Vector {
  return Array.from({ length: DIMENSION_COUNT }, () => 1 / Math.sqrt(DIMENSION_COUNT));
}

/** Normalizza a lunghezza 1; un vettore nullo (o non finito) diventa quello uniforme. */
export function normalize(v: Vector): Vector {
  const n = norm(v);
  if (!Number.isFinite(n) || n < 1e-12) return uniformVector();
  return v.map((x) => x / n);
}

export function dot(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < DIMENSION_COUNT; i++) sum += a[i] * b[i];
  return sum;
}

/** cos(U, V) = (U·V) / (‖U‖·‖V‖), in [-1, 1]; 0 se uno dei due è nullo. */
export function cosineSimilarity(a: Vector, b: Vector): number {
  const denominator = norm(a) * norm(b);
  return denominator < 1e-12 ? 0 : dot(a, b) / denominator;
}

export function isValidVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === DIMENSION_COUNT &&
    value.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

/* ───────────────────────── Vettorizzazione dei post ───────────────────────── */

/**
 * Sintassi dei termini:
 *  - "rust"   → parola intera, case-insensitive
 *  - "compil*" → prefisso (compiler, compiled, compiling…)
 *  - "=Go"    → parola intera, case-sensitive (per sigle ambigue)
 * I termini multi-parola ("open source") sono ammessi.
 */
type Rule = readonly [weight: number, terms: readonly string[]];

const KEYWORDS: Record<Dimension, readonly Rule[]> = {
  Systems_LowLevel: [
    [3, ["rust", "linux", "kernel*", "syscall*", "ebpf", "x86", "malloc", "allocator*", "userspace", "mmap", "segfault", "lock-free", "simd", "zig", "freebsd", "openbsd", "bootloader", "uefi", "systems programming", "low-level", "operating system*", "memory safety", "memory leak*", "c++", "=C"]],
    [2, ["memory", "assembly", "arm64", "filesystem*", "file system*", "scheduler", "linker", "gdb", "bsd", "unsafe", "pointer*", "stack overflow", "page cache", "cache line*", "interrupt*", "=OS", "=Rust"]],
    [1, ["binary", "bytes", "latency", "concurrency", "threads", "performance"]],
  ],
  AI_ML: [
    [3, ["llm*", "gpt*", "chatgpt", "neural", "pytorch", "tensorflow", "inference", "machine learning", "deep learning", "embedding*", "fine-tun*", "llama", "mistral", "neuron*", "reinforcement learning", "language model*", "transformer model*", "generative", "diffusion model*"]],
    [2, ["ai", "ml", "openai", "anthropic", "claude", "prompt*", "dataset*", "gradient*", "cuda", "copilot", "agentic", "agents", "rag", "training data", "model weights", "hallucinat*", "gemini"]],
    [1, ["model*", "training", "benchmark*", "nvidia", "tokens", "agent", "gpu*"]],
  ],
  Web_Frontend: [
    [3, ["react", "next.js", "nextjs", "vue", "svelte", "css", "html", "browser*", "frontend", "front-end", "tailwind", "webpack", "vite", "htmx", "web component*", "pwa", "core web vitals", "a11y", "dom", "web development", "web dev"]],
    [2, ["javascript", "typescript", "angular", "svg", "accessibility", "webkit", "chromium", "wasm", "webassembly", "npm", "node.js", "=JS", "web performance", "web app*", "webgl", "webgpu"]],
    [1, ["web", "ui", "ux", "chrome", "firefox", "safari", "responsive", "deno"]],
  ],
  Backend_Scale: [
    [3, ["backend", "back-end", "microservice*", "golang", "distributed", "scalab*", "scaling", "load balanc*", "kafka", "rabbitmq", "grpc", "consensus", "raft", "paxos", "sharding", "high availability", "fault toleran*", "rate limit*", "event-driven", "monolith*", "idempoten*", "cqrs"]],
    [2, ["resilien*", "architecture*", "queue*", "rest api", "latency", "throughput", "outage*", "erlang", "elixir", "concurren*", "service mesh", "message broker*", "api design"]],
    [1.5, ["=Go"]],
    [1, ["api", "apis", "server*", "async", "production", "java", "spring", "saas"]],
  ],
  Databases: [
    [3, ["postgres*", "mysql", "mariadb", "sqlite", "redis", "sql", "nosql", "database*", "storage engine*", "b-tree*", "lsm", "mongodb", "cassandra", "clickhouse", "duckdb", "query planner", "vector database*", "data warehouse", "olap", "oltp", "key-value", "dynamodb", "datastore*"]],
    [2, ["caching", "cache", "caches", "transaction*", "acid", "replication", "queries", "query", "indexes", "supabase", "vacuum", "=WAL", "write-ahead log", "isolation level*"]],
    [1, ["index", "schema*", "migration*", "=ORM", "data model*"]],
  ],
  Security_Crypto: [
    [3, ["vulnerab*", "exploit*", "cve*", "security", "cryptograph*", "encrypt*", "decrypt*", "malware", "ransomware", "zero-day", "0day", "backdoor", "breach*", "hacking", "hacked", "reverse engineer*", "rce", "xss", "sql injection", "phishing", "pgp", "ctf", "pentest*", "fuzz*", "cryptanalysis", "zero-knowledge", "passkey*", "bug bounty", "infosec", "cybersecurity"]],
    [2, ["injection", "authentication", "password*", "tls", "ssl", "ssh", "privacy", "surveillance", "supply chain", "sandbox*", "vpn", "oauth", "attack*", "attacker*", "ddos", "spyware", "leaked", "secrets"]],
    [1, ["crypto", "leak*", "trust"]],
  ],
  Compilers_PL: [
    [3, ["compil*", "interpreter*", "parser*", "parsing", "ast", "type system*", "type theory", "type inference", "programming language*", "language design", "lisp", "haskell", "ocaml", "clojure", "lexer", "bytecode", "jit", "llvm", "gcc", "clang", "monad*", "functional programming", "transpil*", "garbage collect*", "borrow checker", "metaprogramming", "generics", "plt"]],
    [2, ["syntax", "semantics", "scala", "kotlin", "dsl", "static analysis", "macro*", "lambda", "formal verification", "proof assistant", "coq", "=Lean", "optimizing", "type checker", "typechecker", "refinement types", "algebraic effects"]],
    [1, ["language", "languages", "runtime", "python", "ruby", "swift", "typescript", "scheme"]],
  ],
  OpenSource_Culture: [
    [3, ["open source", "open-source", "opensource", "license*", "licens*", "gpl", "agpl", "foss", "floss", "maintainer*", "governance", "linux foundation", "free software", "stallman", "torvalds", "copyleft", "code of conduct", "bdfl", "relicens*", "gnu", "=OSS", "contributors"]],
    [2, ["community", "foundation", "history", "fork", "forks", "forked", "contributor*", "debian", "mozilla", "preservation", "nostalgia", "sponsorship", "volunteer*", "retrospective", "anniversary", "decades"]],
    [1, ["unix", "bsd", "legacy", "retro", "wikipedia", "apache", "mit"]],
  ],
  DevOps_Infra: [
    [3, ["kubernetes", "k8s", "docker", "ci/cd", "terraform", "ansible", "aws", "gcp", "kubectl", "devops", "sre", "observability", "prometheus", "grafana", "infrastructure", "serverless", "github actions", "nginx", "dns", "bgp", "networking", "cdn", "self-host*", "homelab", "postmortem", "iac", "nixos", "bare metal", "datacenter", "data center", "cloud native"]],
    [2, ["container*", "cloud", "azure", "cloudflare", "helm", "monitoring", "deploy*", "gitlab", "tcp", "network", "vps", "incident*", "uptime", "systemd", "nix", "virtualiz*", "firecracker", "hosting", "quic", "http/2", "http/3", "ipv6", "ipv4"]],
    [1, ["edge", "=VM", "outage*", "pipeline*"]],
  ],
  Math_Algorithms: [
    [3, ["algorithm*", "complexity", "graph theory", "data structure*", "algebra", "theorem*", "np-hard", "np-complete", "big o", "sorting", "hash table*", "binary search", "dynamic programming", "combinatori*", "probabilit*", "calculus", "geometry", "number theory", "bloom filter", "mathematic*", "math", "maths", "fourier", "floating point", "floating-point", "fibonacci", "leetcode", "trie", "automata", "compsci"]],
    [2, ["graph", "graphs", "proof*", "prime", "primes", "sort", "hashing", "statistic*", "matrix", "matrices", "equation*", "optimization", "quantum", "turing", "randomness", "random number*", "recurs*", "lattice", "advent of code"]],
    [1, ["tree", "trees", "heap", "puzzle*"]],
  ],
  Hardware_Embedded: [
    [3, ["microcontroller*", "mcu", "arduino", "esp32", "raspberry pi", "rp2040", "fpga", "verilog", "vhdl", "risc-v", "riscv", "firmware", "embedded", "iot", "electronics", "circuit*", "pcb", "soldering", "silicon", "semiconductor*", "transistor*", "oscilloscope", "hardware", "cortex-m", "lora", "i2c", "uart", "gpio", "rtos", "asic", "apple silicon", "sdr"]],
    [2, ["sensor*", "chip", "chips", "cpu", "bluetooth", "3d print*", "robot*", "drone*", "usb", "=SoC", "=SPI", "raspberry", "analog", "radio", "microchip", "motherboard", "ram"]],
    [1, ["gpu", "satellite*", "keyboard*", "battery", "retro computing"]],
  ],
  Career_Philosophy: [
    [3, ["career*", "burnout", "productivity", "essay", "philosophy", "ethic*", "manifesto", "lessons learned", "mentor*", "senior engineer*", "engineering manager*", "remote work", "layoff*", "salary", "writing code", "clean code", "technical debt", "tech debt", "reflections", "work-life", "imposter", "habits", "practices"]],
    [2, ["interview*", "hiring", "lessons", "advice", "junior", "management", "programmer*", "software engineer*", "craft", "code review*", "simplicity", "why i", "thoughts on", "opinion", "on writing", "learning to", "meetings", "founder*", "bootcamp", "retire*", "ask hn"]],
    [1, ["writing", "learned", "job", "jobs", "developer*", "learn*", "focus", "startup*"]],
  ],
};

/** Tag esatti (Lobsters, HN) → indizi per dimensione. */
const TAG_HINTS: Readonly<Record<string, readonly (readonly [Dimension, number])[]>> = {
  c: [["Systems_LowLevel", 3]],
  rust: [["Systems_LowLevel", 2], ["Compilers_PL", 1]],
  linux: [["Systems_LowLevel", 3]],
  osdev: [["Systems_LowLevel", 3]],
  ai: [["AI_ML", 3]],
  ml: [["AI_ML", 3]],
  web: [["Web_Frontend", 2]],
  javascript: [["Web_Frontend", 3]],
  css: [["Web_Frontend", 3]],
  browsers: [["Web_Frontend", 3]],
  databases: [["Databases", 3]],
  sql: [["Databases", 3]],
  security: [["Security_Crypto", 3]],
  cryptography: [["Security_Crypto", 3]],
  privacy: [["Security_Crypto", 2]],
  reversing: [["Security_Crypto", 3]],
  plt: [["Compilers_PL", 3]],
  compilers: [["Compilers_PL", 3]],
  math: [["Math_Algorithms", 3]],
  compsci: [["Math_Algorithms", 3]],
  devops: [["DevOps_Infra", 3]],
  networking: [["DevOps_Infra", 2]],
  virtualization: [["DevOps_Infra", 2]],
  hardware: [["Hardware_Embedded", 3]],
  distributed: [["Backend_Scale", 3]],
  scaling: [["Backend_Scale", 3]],
  go: [["Backend_Scale", 3]],
  practices: [["Career_Philosophy", 2]],
  philosophy: [["Career_Philosophy", 3]],
  culture: [["OpenSource_Culture", 2]],
  law: [["OpenSource_Culture", 1]],
  history: [["OpenSource_Culture", 2]],
  ask_hn: [["Career_Philosophy", 1]],
  performance: [["Systems_LowLevel", 1], ["Web_Frontend", 1]],
};

/** Domini noti → indizi per dimensione (match sul dominio e sui sottodomini). */
const DOMAIN_HINTS: Readonly<Record<string, readonly (readonly [Dimension, number])[]>> = {
  "lwn.net": [["Systems_LowLevel", 2], ["OpenSource_Culture", 1]],
  "kernel.org": [["Systems_LowLevel", 3]],
  "rust-lang.org": [["Systems_LowLevel", 2], ["Compilers_PL", 2]],
  "go.dev": [["Backend_Scale", 2], ["Compilers_PL", 1]],
  "postgresql.org": [["Databases", 3]],
  "sqlite.org": [["Databases", 3]],
  "redis.io": [["Databases", 3]],
  "arxiv.org": [["AI_ML", 1], ["Math_Algorithms", 1]],
  "openai.com": [["AI_ML", 3]],
  "huggingface.co": [["AI_ML", 3]],
  "anthropic.com": [["AI_ML", 3]],
  "pytorch.org": [["AI_ML", 3]],
  "web.dev": [["Web_Frontend", 3]],
  "css-tricks.com": [["Web_Frontend", 3]],
  "developer.mozilla.org": [["Web_Frontend", 3]],
  "react.dev": [["Web_Frontend", 3]],
  "nextjs.org": [["Web_Frontend", 3]],
  "krebsonsecurity.com": [["Security_Crypto", 3]],
  "schneier.com": [["Security_Crypto", 3]],
  "bleepingcomputer.com": [["Security_Crypto", 3]],
  "kubernetes.io": [["DevOps_Infra", 3]],
  "docker.com": [["DevOps_Infra", 3]],
  "cloudflare.com": [["DevOps_Infra", 2], ["Backend_Scale", 1]],
  "gnu.org": [["OpenSource_Culture", 3]],
  "opensource.org": [["OpenSource_Culture", 3]],
  "eff.org": [["OpenSource_Culture", 1], ["Security_Crypto", 1]],
  "hackaday.com": [["Hardware_Embedded", 3]],
  "adafruit.com": [["Hardware_Embedded", 3]],
  "paulgraham.com": [["Career_Philosophy", 3]],
  "joelonsoftware.com": [["Career_Philosophy", 3]],
  "martinfowler.com": [["Backend_Scale", 1], ["Career_Philosophy", 1]],
};

interface CompiledRule {
  weight: number;
  pattern: RegExp;
  dimension: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

function compileTerm(spec: string): RegExp {
  let term = spec;
  const caseSensitive = term.startsWith("=");
  if (caseSensitive) term = term.slice(1);
  const prefix = term.endsWith("*");
  if (prefix) term = term.slice(0, -1);
  const left = "(?<![A-Za-z0-9])";
  const right = prefix ? "" : "(?![A-Za-z0-9])";
  return new RegExp(left + escapeRegExp(term) + right, caseSensitive ? "" : "i");
}

const COMPILED_RULES: readonly CompiledRule[] = DIMENSIONS.flatMap((dimension, index) =>
  KEYWORDS[dimension].flatMap(([weight, terms]) =>
    terms.map((term) => ({ weight, pattern: compileTerm(term), dimension: index })),
  ),
);

/** Peso del campo in cui compare la keyword. */
const FIELD_WEIGHT = { title: 1, tags: 1, url: 0.5, snippet: 0.4 } as const;

export interface PostVector {
  /** Vettore a lunghezza unitaria (‖V‖ = 1). */
  vector: Vector;
  /** 0 = nessun segnale riconosciuto (vettore neutro), 1 = segnale pieno. */
  confidence: number;
  /** Indice della dimensione dominante. */
  topIndex: number;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/** Testo dell'URL privato del protocollo e dei separatori, per intercettare keyword nel path. */
function urlText(url: string): string {
  return url
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/[/_\-?=&#]+/g, " ");
}

/** Segnale minimo (somma dei pesi) per considerare la classificazione affidabile al 100%. */
const FULL_CONFIDENCE_SIGNAL = 4;

/**
 * Vettorizzazione euristica: somma i pesi delle keyword trovate in titolo, tag, URL e
 * snippet, smorza con log1p (evita che una sola dimensione con molte ripetizioni domini)
 * e normalizza a lunghezza 1. Senza alcun segnale restituisce il vettore neutro.
 */
export function vectorizePost(post: TechPost): PostVector {
  const raw = new Array<number>(DIMENSION_COUNT).fill(0);

  const tagsText = post.tags.join(" | ");
  const path = urlText(post.url);
  const snippet = post.summarySnippet ?? "";

  for (const rule of COMPILED_RULES) {
    let score = 0;
    if (rule.pattern.test(post.title)) score += FIELD_WEIGHT.title;
    if (tagsText && rule.pattern.test(tagsText)) score += FIELD_WEIGHT.tags;
    if (rule.pattern.test(path)) score += FIELD_WEIGHT.url;
    if (snippet && rule.pattern.test(snippet)) score += FIELD_WEIGHT.snippet;
    raw[rule.dimension] += rule.weight * score;
  }

  for (const tag of post.tags) {
    for (const [dimension, weight] of TAG_HINTS[tag.toLowerCase()] ?? []) {
      raw[DIMENSIONS.indexOf(dimension)] += weight;
    }
  }

  const host = hostOf(post.url);
  if (host) {
    for (const [domain, hints] of Object.entries(DOMAIN_HINTS)) {
      if (host === domain || host.endsWith(`.${domain}`)) {
        for (const [dimension, weight] of hints) raw[DIMENSIONS.indexOf(dimension)] += weight;
      }
    }
  }

  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return { vector: uniformVector(), confidence: 0, topIndex: 0 };
  }

  const vector = normalize(raw.map((x) => Math.log1p(x)));
  let topIndex = 0;
  for (let i = 1; i < DIMENSION_COUNT; i++) if (vector[i] > vector[topIndex]) topIndex = i;

  return { vector, confidence: Math.min(1, total / FULL_CONFIDENCE_SIGNAL), topIndex };
}

/* ───────────────────────── Aggiornamento dello user vector ───────────────────────── */

export type InteractionKind = "like" | "bookmark" | "read" | "skip";

/** Coefficienti di apprendimento: Like 0.20, Bookmark/Lettura 0.25, Skip −0.15. */
export const INTERACTION_WEIGHTS: Record<InteractionKind, number> = {
  like: 0.2,
  bookmark: 0.25,
  read: 0.25,
  skip: -0.15,
};

/** Passo dell'override manuale su un singolo tema. */
export const OVERRIDE_STEP = 0.15;

/** U ← Normalize(U + w·V). */
export function applyInteraction(user: Vector, post: Vector, kind: InteractionKind): Vector {
  const w = INTERACTION_WEIGHTS[kind];
  return normalize(user.map((u, i) => u + w * post[i]));
}

/** Override manuale: spinge (direction = 1) o attenua (−1) una dimensione. */
export function applyOverride(user: Vector, dimensionIndex: number, direction: 1 | -1): Vector {
  return normalize(user.map((u, i) => (i === dimensionIndex ? u + direction * OVERRIDE_STEP : u)));
}

/* ───────────────────────── Ranking epsilon-greedy ───────────────────────── */

export const DEFAULT_EPSILON = 0.15;
export const EPSILON_MIN = 0.05;
export const EPSILON_MAX = 0.5;

/** Emivita del decay temporale, in ore. */
export const DECAY_HALF_LIFE_HOURS = 12;

export type FeedSlot = "exploit" | "frontier" | "archive";

export interface RankedPost {
  post: TechPost;
  slot: FeedSlot;
  /** Cosine similarity con lo user vector al momento del ranking. */
  affinity: number;
  /** Punteggio di exploit (0 per i post iniettati dall'explore). */
  score: number;
}

export interface RankOptions {
  /** Quota explore in [0.05, 0.5]. */
  epsilon: number;
  /** Istante di riferimento (ms epoch) per il decay temporale. */
  now: number;
}

interface Scored {
  post: TechPost;
  affinity: number;
  community: number;
  decay: number;
  confidence: number;
  score: number;
}

export function clampEpsilon(epsilon: number): number {
  if (!Number.isFinite(epsilon)) return DEFAULT_EPSILON;
  return Math.min(EPSILON_MAX, Math.max(EPSILON_MIN, epsilon));
}

/** Consenso della community in [0,1]: log(punti + ½·commenti) relativo al massimo della stessa fonte. */
function communityScores(posts: readonly TechPost[]): Map<string, number> {
  const raw = (p: TechPost) => Math.log1p(Math.max(0, p.points) + 0.5 * Math.max(0, p.commentsCount));
  const groupKey = (p: TechPost) => `${p.source}:${p.isArchive ? "archive" : "live"}`;

  const maxByGroup = new Map<string, number>();
  for (const p of posts) {
    maxByGroup.set(groupKey(p), Math.max(maxByGroup.get(groupKey(p)) ?? 0, raw(p)));
  }
  const scores = new Map<string, number>();
  for (const p of posts) {
    const max = maxByGroup.get(groupKey(p)) ?? 0;
    scores.set(p.id, max > 0 ? raw(p) / max : 0);
  }
  return scores;
}

function scorePosts(
  posts: readonly TechPost[],
  vectors: ReadonlyMap<string, PostVector>,
  user: Vector,
  now: number,
): Scored[] {
  const community = communityScores(posts);
  return posts.map((post) => {
    const pv = vectors.get(post.id) ?? vectorizePost(post);
    const affinity = cosineSimilarity(user, pv.vector);
    const ageHours = Math.max(0, (now - Date.parse(post.publishedAt)) / 3_600_000);
    const decay = Math.pow(0.5, ageHours / DECAY_HALF_LIFE_HOURS);
    const c = community.get(post.id) ?? 0;
    // Affinità modulata da consenso, freschezza e affidabilità della classificazione.
    const score =
      Math.max(0, affinity) *
      (0.55 + 0.45 * c) *
      (0.45 + 0.55 * decay) *
      (0.5 + 0.5 * pv.confidence);
    return { post, affinity, community: c, decay, confidence: pv.confidence, score };
  });
}

const byScoreDesc = (a: Scored, b: Scored) => b.score - a.score || a.post.id.localeCompare(b.post.id);

/** Scoperta fuori bolla: tra i post a bassa affinità (40% inferiore) quello con più consenso. */
function pickFrontier(pool: Scored[]): Scored | undefined {
  if (pool.length === 0) return undefined;
  const withSignal = pool.filter((s) => s.confidence > 0);
  const base = withSignal.length > 0 ? withSignal : pool;
  const lowAffinity = [...base]
    .sort((a, b) => a.affinity - b.affinity || a.post.id.localeCompare(b.post.id))
    .slice(0, Math.max(1, Math.ceil(base.length * 0.4)));
  return lowAffinity.reduce((best, s) => {
    const value = (x: Scored) => x.community * (0.6 + 0.4 * x.decay);
    return value(s) > value(best) ? s : best;
  });
}

/** Perla d'archivio: la più affine (e apprezzata) tra quelle non ancora usate. */
function pickArchive(pool: Scored[]): Scored | undefined {
  if (pool.length === 0) return undefined;
  const value = (x: Scored) => Math.max(0.05, x.affinity) * (0.5 + 0.5 * x.community);
  return pool.reduce((best, s) => (value(s) > value(best) ? s : best));
}

/**
 * Ordina il feed con epsilon-greedy.
 *
 * - Exploit: i post live per `score` decrescente.
 * - Explore: ogni ≈ 1/ε posizioni (5-6 post con ε ≈ 15-20%) viene iniettato, in
 *   alternanza, un post "fuori bolla" (bassa affinità, alto consenso) e una perla
 *   dell'archivio storico. Se una delle due categorie si esaurisce si usa l'altra.
 *
 * Deterministico: stessi input → stesso ordine.
 */
export function rankFeed(
  posts: readonly TechPost[],
  vectors: ReadonlyMap<string, PostVector>,
  user: Vector,
  options: RankOptions,
): RankedPost[] {
  const epsilon = clampEpsilon(options.epsilon);
  const scored = scorePosts(posts, vectors, user, options.now);
  const livePool = scored.filter((s) => !s.post.isArchive);
  const archivePool = scored.filter((s) => s.post.isArchive);

  const slotCount = Math.max(1, Math.round(epsilon * livePool.length));
  const explore: RankedPost[] = [];
  const usedFrontier = new Set<string>();
  const usedArchive = new Set<string>();

  for (let k = 1; k <= slotCount; k++) {
    const wantFrontier = k % 2 === 1;
    const frontier = () => pickFrontier(livePool.filter((s) => !usedFrontier.has(s.post.id)));
    const archive = () => pickArchive(archivePool.filter((s) => !usedArchive.has(s.post.id)));

    let chosen: { item: Scored; slot: FeedSlot } | undefined;
    const first = wantFrontier ? frontier() : archive();
    if (first) {
      chosen = { item: first, slot: wantFrontier ? "frontier" : "archive" };
    } else {
      const second = wantFrontier ? archive() : frontier();
      if (second) chosen = { item: second, slot: wantFrontier ? "archive" : "frontier" };
    }
    if (!chosen) break;

    (chosen.slot === "frontier" ? usedFrontier : usedArchive).add(chosen.item.post.id);
    explore.push({ post: chosen.item.post, slot: chosen.slot, affinity: chosen.item.affinity, score: 0 });
  }

  const exploit: RankedPost[] = livePool
    .filter((s) => !usedFrontier.has(s.post.id))
    .sort(byScoreDesc)
    .map((s) => ({ post: s.post, slot: "exploit", affinity: s.affinity, score: s.score }));

  // Fusione: l'k-esimo post esplorativo occupa la posizione floor(k/ε) − 1 (0-based).
  const period = 1 / epsilon;
  const result: RankedPost[] = [];
  let e = 0;
  let x = 0;
  while (e < explore.length || x < exploit.length) {
    const nextExploreIndex = Math.floor((e + 1) * period) - 1;
    const exploreDue = e < explore.length && (result.length >= nextExploreIndex || x >= exploit.length);
    if (exploreDue) result.push(explore[e++]);
    else result.push(exploit[x++]);
  }
  return result;
}

/* ───────────────────────── Helper di presentazione ───────────────────────── */

export function matchPercent(affinity: number): number {
  return Math.min(100, Math.max(0, Math.round(affinity * 100)));
}

/**
 * Dimensione da mostrare nel badge: quella in cui utente e post si sovrappongono di più;
 * se non c'è sovrapposizione positiva, la dimensione dominante del post.
 */
export function badgeDimension(user: Vector, post: PostVector): Dimension {
  let best = -1;
  let bestValue = 0;
  for (let i = 0; i < DIMENSION_COUNT; i++) {
    const overlap = Math.max(0, user[i]) * post.vector[i];
    if (overlap > bestValue) {
      bestValue = overlap;
      best = i;
    }
  }
  return DIMENSIONS[best >= 0 ? best : post.topIndex];
}
