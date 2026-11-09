import { afterEach, before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { extractArticle } from "./article.ts";
import { fetchHtml, isPublicIp, validateUrl } from "./safe-fetch.ts";

const PAGE = `<!doctype html><html><head><title>Fallback title</title>
<meta property="og:title" content="Why &amp; how Redis is fast">
<meta property="og:site_name" content="Antirez">
<meta name="author" content="Salvatore">
<meta property="og:description" content="A short description">
</head><body>
<nav><p>Home About Contact us today for a free quote on everything we sell here</p></nav>
<header><h1>Site header</h1></header>
<article>
<h1>Why Redis is fast</h1>
<p>Redis keeps the whole dataset in memory and serves it from a single-threaded event loop, which avoids lock contention.</p>
<p>Persistence is optional: an append-only file records every write, and a background process rewrites it periodically.</p>
<pre><code>int main(void) {
  return serve(6379);
}</code></pre>
<ul><li>Short</li><li>Each command is atomic because commands run one at a time on the hot path of the server.</li></ul>
<p>Copyright &copy; 2026 &mdash; all rights reserved by the author of this article.</p>
</article>
<footer><p>Footer text that should never appear in the extracted article content at all.</p></footer>
<script>var x = "<p>not content not content not content not content not content</p>";</script>
</body></html>`;

describe("indirizzi pubblici", () => {
  it("accetta solo IP instradabili pubblicamente", () => {
    for (const ok of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2a00:1450:4001:81b::200e"]) {
      assert.equal(isPublicIp(ok), true, ok);
    }
    for (const bad of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "ff02::1", "not-an-ip", "",
    ]) {
      assert.equal(isPublicIp(bad), false, bad);
    }
  });

  it("validateUrl rifiuta protocolli, credenziali, porte e IP letterali privati", () => {
    const check = (u: string) => validateUrl(new URL(u), false);
    assert.equal(check("https://example.com/a"), null);
    assert.equal(check("http://example.com:80/a"), null);
    assert.match(check("ftp://example.com/") ?? "", /protocollo/);
    assert.match(check("file:///etc/passwd") ?? "", /protocollo/);
    assert.match(check("https://user:pw@example.com/") ?? "", /credenziali/);
    assert.match(check("http://example.com:8080/") ?? "", /porta/);
    assert.equal(validateUrl(new URL("http://127.0.0.1:3999/x"), true), null); // flag solo per i test
    assert.match(check("http://169.254.169.254/latest/meta-data/") ?? "", /indirizzo/);
    assert.match(check("http://[::1]/") ?? "", /indirizzo/);
    assert.match(check("http://2130706433/") ?? "", /indirizzo/); // 127.0.0.1 in forma decimale
    assert.match(check("http://0x7f.1/") ?? "", /indirizzo/);
  });
});

describe("estrazione dell'articolo", () => {
  it("estrae testo, codice e metadati ignorando navigazione, footer e script", () => {
    const a = extractArticle(PAGE, "https://antirez.com/news/1");
    assert.ok(a);
    assert.equal(a.title, "Why & how Redis is fast");
    assert.equal(a.siteName, "Antirez");
    assert.equal(a.byline, "Salvatore");
    assert.match(a.text, /single-threaded event loop/);
    assert.match(a.text, /```\nint main\(void\) \{\n {2}return serve\(6379\);\n\}\n```/);
    assert.match(a.text, /Copyright © 2026 — all rights/);
    assert.match(a.text, /^## Why Redis is fast/m);
    assert.doesNotMatch(a.text, /Home About|Footer text|not content|Site header/);
    assert.ok(a.wordCount > 40);
    assert.equal(a.truncated, false);
  });

  it("restituisce null per pagine senza testo utile", () => {
    assert.equal(extractArticle("<html><body><p>Hi</p></body></html>", "https://x.test"), null);
    assert.equal(extractArticle("", "https://x.test"), null);
  });

  it("tronca i testi molto lunghi", () => {
    const body = Array.from({ length: 400 }, (_, i) => `<p>Paragraph number ${i} with enough words to be considered meaningful content.</p>`).join("");
    const a = extractArticle(`<body>${body}</body>`, "https://x.test");
    assert.ok(a?.truncated);
    assert.ok((a?.text.length ?? 0) <= 14_001);
  });
});

describe("download sicuro", () => {
  let server: http.Server;
  let base = "";
  const originalLookup = dns.lookup;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/page") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(PAGE);
      } else if (req.url === "/gzip") {
        res.setHeader("content-type", "text/html");
        res.setHeader("content-encoding", "gzip");
        res.end(zlib.gzipSync(PAGE));
      } else if (req.url === "/r1") {
        res.writeHead(302, { location: "/r2" }).end();
      } else if (req.url === "/r2") {
        res.writeHead(301, { location: "/page" }).end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" }).end();
      } else if (req.url === "/pdf") {
        res.setHeader("content-type", "application/pdf");
        res.end("%PDF-1.4");
      } else if (req.url === "/big") {
        res.setHeader("content-type", "text/html");
        res.end("<p>" + "x".repeat(200_000) + "</p>");
      } else if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 2000);
      } else {
        res.writeHead(404).end("nope");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());
  afterEach(() => {
    dns.lookup = originalLookup;
  });

  const local = { allowPrivate: true };

  it("scarica HTML, anche compresso, e segue i redirect", async () => {
    for (const path of ["/page", "/gzip", "/r1"]) {
      const r = await fetchHtml(base + path, local);
      assert.ok(r.ok, path + JSON.stringify(r));
      assert.match(r.html, /single-threaded event loop/);
    }
    const r = await fetchHtml(base + "/r1", local);
    assert.ok(r.ok && r.finalUrl.endsWith("/page"));
  });

  it("gestisce errori HTTP, loop, contenuti non HTML, corpi enormi e timeout senza lanciare", async () => {
    assert.deepEqual(await fetchHtml(base + "/missing", local), { ok: false, reason: "HTTP 404" });
    const loop = await fetchHtml(base + "/loop", local);
    assert.ok(!loop.ok && /troppi redirect/.test(loop.reason));
    const pdf = await fetchHtml(base + "/pdf", local);
    assert.ok(!pdf.ok && /non HTML/.test(pdf.reason));
    const big = await fetchHtml(base + "/big", { ...local, maxBytes: 50_000 });
    assert.ok(big.ok && big.truncated && big.html.length <= 50_000);
    const slow = await fetchHtml(base + "/slow", { ...local, timeoutMs: 300 });
    assert.ok(!slow.ok && /timeout/.test(slow.reason));
    assert.ok(!(await fetchHtml("not a url")).ok);
  });

  it("rifiuta per default gli indirizzi privati (loopback letterale)", async () => {
    const r = await fetchHtml(base + "/page");
    assert.deepEqual(r, { ok: false, reason: "indirizzo non consentito" });
  });

  it("rifiuta un dominio che risolve verso un indirizzo privato (anti DNS-rebinding)", async () => {
    dns.lookup = ((host: string, _opts: unknown, cb: (e: Error | null, a: unknown) => void) => {
      cb(null, [{ address: "10.0.0.5", family: 4 }]);
    }) as unknown as typeof dns.lookup;
    const r = await fetchHtml("http://innocent-looking.example/page");
    assert.deepEqual(r, { ok: false, reason: "indirizzo non consentito" });
  });

  it("rifiuta se anche UNO solo degli indirizzi risolti è privato", async () => {
    dns.lookup = ((host: string, _opts: unknown, cb: (e: Error | null, a: unknown) => void) => {
      cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    }) as unknown as typeof dns.lookup;
    const r = await fetchHtml("http://mixed.example/page");
    assert.deepEqual(r, { ok: false, reason: "indirizzo non consentito" });
  });
});
