// Breadth-first crawler that respects robots.txt. Seeds are ranked domains (the Tranco list); each worker
// takes one host at a time, reads its robots.txt, fetches the home page and a few internal
// pages with a delay between requests, and queues newly seen outbound hosts. Outbound
// host links are recorded for PageRank.
//
//   node crawler/crawl.ts --seeds seeds.csv --out data/crawl --max-pages 12000
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BloomFilter } from "./bloom.ts";
import { extract, looksEnglish } from "./extract.ts";
import { fetchHtml, fetchRobots, isChallenge, isFamilySafe } from "./fetch.ts";
import type { Page } from "./fetch.ts";
import { closeBrowser, render } from "./render.ts";
import { terms } from "./text.ts";

const { values: opt } = parseArgs({
  options: {
    seeds: { type: "string" },
    out: { type: "string", default: "data/crawl" },
    "max-pages": { type: "string", default: "12000" },
    "max-seeds": { type: "string", default: "20000" },
    "per-host": { type: "string", default: "4" },
    concurrency: { type: "string", default: "32" },
    "delay-ms": { type: "string", default: "1500" },
    "max-minutes": { type: "string", default: "300" },
    "discover-share": { type: "string", default: "0.25" },
  },
});

const MAX_PAGES = Number(opt["max-pages"]);
const PER_HOST = Number(opt["per-host"]);
const CONCURRENCY = Number(opt.concurrency);
const DELAY_MS = Number(opt["delay-ms"]);
const MAX_DELAY_MS = 10_000;
const DEADLINE = Date.now() + Number(opt["max-minutes"]) * 60_000;
const DISCOVER_SHARE = Number(opt["discover-share"]);
const OUT = opt.out!;
const MIN_TERMS = 40;

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|tar|rar|7z|exe|dmg|apk|mp[34]|mov|avi|wav|css|js|json|xml|rss|txt|csv|docx?|xlsx?|pptx?)$/i;
const SKIP_PATH = /(login|signin|sign-in|signup|register|account|cart|checkout|privacy|cookie|terms|legal|password|logout|wp-admin)/i;

/** Host without a leading www. */
const hostOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

// ---- seeds and frontier ----
if (!opt.seeds) throw new Error("--seeds <file> is required (CSV of rank,domain or one domain per line)");
const seeds = readFileSync(opt.seeds, "utf8")
  .split("\n")
  .map((l) => l.trim().split(",").at(-1)!.toLowerCase())
  .filter((d) => d && !d.startsWith("#"))
  .slice(0, Number(opt["max-seeds"]));

const seenHosts = new BloomFilter(200_000, 0.001);
const seenUrls = new BloomFilter(500_000, 0.001);
const seedQueue: string[] = [];
const discovered: string[] = [];
for (const d of seeds) if (seenHosts.addIfNew(d.replace(/^www\./, ""))) seedQueue.push(d.replace(/^www\./, ""));

let taken = 0;
function nextHost(): string | undefined {
  taken++;
  // Mostly seeds in rank order, with a share of hosts found by following links.
  const fromDiscovered = discovered.length > 0 && (seedQueue.length === 0 || (taken * DISCOVER_SHARE) % 1 < DISCOVER_SHARE);
  return fromDiscovered ? discovered.shift() : seedQueue.shift();
}

// ---- output ----
mkdirSync(OUT, { recursive: true });
for (const f of ["pages.jsonl", "hosts.jsonl", "edges.jsonl"]) writeFileSync(`${OUT}/${f}`, "");
const stats = { pages: 0, rendered: 0, hosts: 0, statuses: {} as Record<string, number>, started: new Date().toISOString(), finished: "" };
let pageId = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const done = () => stats.pages >= MAX_PAGES || Date.now() > DEADLINE;

/** Internal links worth fetching: same host, shallow, no query, not a file or account page. */
function pickInternal(links: string[], host: string, allowed: (u: string) => boolean): string[] {
  const out = new Set<string>();
  for (const l of links) {
    let u: URL;
    try {
      u = new URL(l);
    } catch {
      continue;
    }
    if (hostOf(l) !== host || u.search || SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) continue;
    const depth = u.pathname.split("/").filter(Boolean).length;
    if (depth === 0 || depth > 2) continue;
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    out.add(u.toString());
  }
  return [...out].filter(allowed).sort((a, b) => a.length - b.length);
}

async function crawlHost(host: string): Promise<string> {
  // Skip unless the family-safe resolver positively says the domain is fine.
  const safe = await isFamilySafe(host);
  if (safe === null) return "safety-check-failed";
  if (!safe) return "blocked";
  const origin = `https://${host}`;
  const robots = await fetchRobots(origin);
  if (!robots.reachable) return "robots-unreachable";
  if (!robots.allowed(`${origin}/`)) return "robots";
  const delay = Math.min(Math.max(DELAY_MS, robots.delayMs ?? 0), MAX_DELAY_MS);

  const queue = [`${origin}/`];
  const outLinks = new Map<string, number>();
  let saved = 0;
  let status = "empty";
  for (let i = 0; i < queue.length && saved < PER_HOST && !done(); i++) {
    if (i > 0) await sleep(delay);
    const got = await fetchHtml(queue[i]);
    // 403/429/503: the site is refusing or rate-limiting us, so leave it alone.
    if (got && "refused" in got) return saved ? "ok" : `refused-${got.refused}`;
    let page: Page | null = got;
    if (!page) {
      if (i === 0) return "error";
      continue;
    }
    if (!seenUrls.addIfNew(page.url) && i > 0) continue;
    let e = extract(page.html, page.url);
    let text = `${e.title} ${e.description} ${e.headings} ${e.body}`;
    if (isChallenge(e.title, e.body)) return saved ? "ok" : "challenge";
    // Too little text usually means the content is built by JavaScript: render it.
    if (terms(text).length < MIN_TERMS) {
      const r = await render(page.url);
      if (r && r.status !== 403 && r.status !== 429 && r.status !== 503) {
        const re = extract(r.html, r.url);
        if (isChallenge(re.title, re.body)) return saved ? "ok" : "challenge";
        page = r;
        e = re;
        text = `${e.title} ${e.description} ${e.headings} ${e.body}`;
        stats.rendered++;
      }
    }
    if (!looksEnglish(e)) {
      if (i === 0) return "non-english";
      continue;
    }
    for (const l of e.links) {
      try {
        const h = hostOf(l);
        if (h !== host && h.includes(".")) outLinks.set(h, (outLinks.get(h) ?? 0) + 1);
      } catch {
        // Unparseable link.
      }
    }
    if (i === 0) queue.push(...pickInternal(e.links, host, robots.allowed).slice(0, PER_HOST * 3));
    if (terms(text).length < MIN_TERMS) continue;
    appendFileSync(
      `${OUT}/pages.jsonl`,
      JSON.stringify({ id: pageId++, url: page.url, host, title: e.title, description: e.description, headings: e.headings, body: e.body }) + "\n",
    );
    saved++;
    stats.pages++;
    status = "ok";
  }
  if (outLinks.size) appendFileSync(`${OUT}/edges.jsonl`, JSON.stringify({ host, out: Object.fromEntries(outLinks) }) + "\n");
  for (const h of outLinks.keys()) if (seenHosts.addIfNew(h)) discovered.push(h);
  return saved ? status : "empty";
}

async function worker() {
  while (!done()) {
    const host = nextHost();
    if (!host) return;
    const t = Date.now();
    let status: string;
    try {
      status = await crawlHost(host);
    } catch {
      status = "error";
    }
    stats.hosts++;
    stats.statuses[status] = (stats.statuses[status] ?? 0) + 1;
    appendFileSync(`${OUT}/hosts.jsonl`, JSON.stringify({ host, status, ms: Date.now() - t }) + "\n");
    if (stats.hosts % 50 === 0) console.log(`${new Date().toISOString()} hosts=${stats.hosts} pages=${stats.pages} queue=${seedQueue.length}+${discovered.length} ${JSON.stringify(stats.statuses)}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await closeBrowser();
stats.finished = new Date().toISOString();
writeFileSync(`${OUT}/stats.json`, JSON.stringify({ ...stats, seenUrlsFalsePositiveRate: seenUrls.falsePositiveRate, discoveredLeft: discovered.length }, null, 2));
console.log("done", JSON.stringify(stats));
