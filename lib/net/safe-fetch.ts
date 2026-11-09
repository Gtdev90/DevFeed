/**
 * Download sicuro di pagine web controllate da terzi (l'URL di un post lo sceglie chi lo
 * sottomette). Difese contro SSRF:
 *  - solo http/https su porte standard, niente credenziali nell'URL;
 *  - il resolver DNS usato per CONNETTERSI rifiuta indirizzi privati, loopback, link-local,
 *    multicast ecc. (nessuna finestra di DNS rebinding: la connessione usa l'IP già validato);
 *  - gli IP letterali sono controllati prima della richiesta;
 *  - ogni redirect viene rivalidato dall'inizio (max 3);
 *  - timeout complessivo e tetto alla dimensione del corpo.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

// Due liste separate: in net.BlockList una subnet IPv6 "::ffff:0:0/96" (IPv4-mapped)
// corrisponde anche a TUTTI gli indirizzi IPv4, quindi non va mai inserita qui.
const BLOCKED_V4 = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_V4.addSubnet(addr, prefix, "ipv4");

const BLOCKED_V6 = new net.BlockList();
for (const [addr, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) BLOCKED_V6.addSubnet(addr, prefix, "ipv6");

/** true solo per indirizzi IP pubblici instradabili. */
export function isPublicIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !BLOCKED_V4.check(ip, "ipv4");
  if (family === 6) {
    // Forma canonica: "::ffff:7f00:1", "::ffff:127.0.0.1" e "0:0:0:0:0:ffff:7f00:1" coincidono.
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
    if (canonical.startsWith("::ffff:")) return false; // IPv4-mapped: mai legittimo da un DNS pubblico
    return !BLOCKED_V6.check(ip, "ipv6");
  }
  return false;
}

export type FetchHtmlResult =
  | { ok: true; html: string; finalUrl: string; truncated: boolean }
  | { ok: false; reason: string };

export interface FetchHtmlOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** SOLO per i test con server locali: disattiva il blocco degli indirizzi privati. */
  allowPrivate?: boolean;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicIp(a.address))) {
      return callback(Object.assign(new Error("indirizzo non consentito"), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export function validateUrl(url: URL, allowPrivate: boolean): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "protocollo non consentito";
  if (url.username || url.password) return "credenziali nell'URL non consentite";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && net.isIP(host) && !isPublicIp(host)) return "indirizzo non consentito";
  if (!allowPrivate && url.port && url.port !== "80" && url.port !== "443") return "porta non consentita";
  return null;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
}

function requestOnce(url: URL, o: Required<FetchHtmlOptions>): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": "PulseDevApp/1.0 (article reader)",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "gzip, deflate, br",
        },
        ...(o.allowPrivate ? {} : { lookup: guardedLookup as unknown as net.LookupFunction }),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false });
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream: NodeJS.ReadableStream =
          encoding === "gzip" ? res.pipe(zlib.createGunzip())
          : encoding === "deflate" ? res.pipe(zlib.createInflate())
          : encoding === "br" ? res.pipe(zlib.createBrotliDecompress())
          : res;

        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const finish = () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated });
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > o.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - o.maxBytes)));
            res.destroy();
            return finish();
          }
          chunks.push(chunk);
        });
        stream.on("end", finish);
        stream.on("error", (e) => (truncated ? finish() : reject(e)));
        res.on("error", (e) => (truncated ? finish() : reject(e)));
      },
    );
    req.setTimeout(o.timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 2048).toString("latin1"))?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return body.toString("utf8");
  }
}

/** Scarica una pagina HTML in modo sicuro. Non lancia mai: restituisce `{ok:false, reason}`. */
export async function fetchHtml(rawUrl: string, options: FetchHtmlOptions = {}): Promise<FetchHtmlResult> {
  const o: Required<FetchHtmlOptions> = {
    maxBytes: options.maxBytes ?? 1_500_000,
    timeoutMs: options.timeoutMs ?? 8_000,
    maxRedirects: options.maxRedirects ?? 3,
    allowPrivate: options.allowPrivate ?? false,
  };
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL non valido" };
  }

  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    const problem = validateUrl(current, o.allowPrivate);
    if (problem) return { ok: false, reason: problem };

    let res: RawResponse;
    try {
      res = await requestOnce(current, o);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EBLOCKED") return { ok: false, reason: "indirizzo non consentito" };
      return { ok: false, reason: code === "ENOTFOUND" ? "dominio non trovato" : `richiesta fallita (${(err as Error).message})` };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) return { ok: false, reason: `redirect senza destinazione (HTTP ${res.status})` };
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, reason: "redirect non valido" };
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) return { ok: false, reason: `HTTP ${res.status}` };

    const contentType = String(res.headers["content-type"] ?? "");
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return { ok: false, reason: `contenuto non HTML (${contentType.split(";")[0] || "tipo sconosciuto"})` };
    }
    return { ok: true, html: decode(res.body, contentType), finalUrl: current.toString(), truncated: res.truncated };
  }
  return { ok: false, reason: "troppi redirect" };
}
