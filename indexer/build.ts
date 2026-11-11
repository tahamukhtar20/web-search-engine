// Turn a crawl into the static index the site serves:
//   <out>/meta.json, <out>/docs.json, <out>/t/<shard>.json
// and <crawl>/embed.jsonl (text to embed for semantic search; not published).
//
//   node indexer/build.ts --crawl data/crawl --out web/public/index
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { terms } from "../crawler/text.ts";
import { shardOf } from "../search/core.ts";
import type { Docs, Meta, Shard } from "../search/core.ts";
import { pagerank } from "./pagerank.ts";

const { values: opt } = parseArgs({
  options: {
    crawl: { type: "string", default: "data/crawl" },
    out: { type: "string", default: "web/public/index" },
    shards: { type: "string", default: "128" },
  },
});
const SHARDS = Number(opt.shards);
const K1 = 1.2;
const B = 0.75;
const HEAD_WEIGHT = 2;
// Enough to break ties between similar matches, not to override a better text match.
const PR_WEIGHT = 0.3;
/** Body terms that occur in only one document and not in its head are dropped (typos, ids). */
const MIN_DF_BODY_ONLY = 2;

type PageRow = { id: number; url: string; host: string; title: string; description: string; headings: string; body: string };

const readJsonl = <T>(path: string): T[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as T)
    : [];

const pages = readJsonl<PageRow>(`${opt.crawl}/pages.jsonl`);
if (!pages.length) throw new Error(`no pages in ${opt.crawl}/pages.jsonl`);

// ---- PageRank over hosts ----
const edges = new Map<string, Map<string, number>>();
for (const { host, out } of readJsonl<{ host: string; out: Record<string, number> }>(`${opt.crawl}/edges.jsonl`)) {
  const m = edges.get(host) ?? new Map<string, number>();
  for (const [to, w] of Object.entries(out)) m.set(to, (m.get(to) ?? 0) + w);
  edges.set(host, m);
}
const pr = pagerank(edges);
// Log scale so a few huge hosts don't flatten everyone else; scaled to [0, 1].
const prLog = (h: string) => Math.log10(1 + (pr.rank.get(h) ?? 0) * pr.hosts);
const prMax = Math.max(...pages.map((p) => prLog(p.host)), 1e-9);

// ---- documents and postings ----
const docs: Docs = { url: [], title: [], description: [], host: [], lenHead: [], lenBody: [], prBoost: [] };
const postings = new Map<string, [number, number, number][]>();
const inHead = new Set<string>();
const embed: string[] = [];
const seenUrl = new Set<string>();

for (const p of pages) {
  if (seenUrl.has(p.url)) continue;
  seenUrl.add(p.url);
  const id = docs.url.length;
  const head = terms(`${p.title} ${p.description} ${p.headings}`);
  const body = terms(p.body);
  docs.url.push(p.url);
  docs.title.push(p.title || p.url);
  docs.description.push((p.description || p.body).slice(0, 240));
  docs.host.push(p.host);
  docs.lenHead.push(head.length);
  docs.lenBody.push(body.length);
  docs.prBoost.push(+(prLog(p.host) / prMax).toFixed(4));

  const tf = new Map<string, [number, number]>();
  for (const t of head) {
    const c = tf.get(t) ?? [0, 0];
    c[0]++;
    tf.set(t, c);
    inHead.add(t);
  }
  for (const t of body) {
    const c = tf.get(t) ?? [0, 0];
    c[1]++;
    tf.set(t, c);
  }
  for (const [t, [h, bd]] of tf) {
    const list = postings.get(t) ?? [];
    list.push([id, h, bd]);
    postings.set(t, list);
  }
  embed.push(JSON.stringify({ id, text: `${p.title}. ${p.description}. ${p.headings}. ${p.body}`.slice(0, 2000) }));
}

const n = docs.url.length;
const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

// ---- write ----
if (existsSync(opt.out!)) rmSync(opt.out!, { recursive: true });
mkdirSync(`${opt.out}/t`, { recursive: true });
const shards: Shard[] = Array.from({ length: SHARDS }, () => ({}));
let kept = 0;
for (const [t, list] of postings) {
  if (list.length < MIN_DF_BODY_ONLY && !inHead.has(t)) continue;
  shards[shardOf(t, SHARDS)][t] = list;
  kept++;
}
shards.forEach((s, i) => writeFileSync(`${opt.out}/t/${i}.json`, JSON.stringify(s)));
writeFileSync(`${opt.out}/docs.json`, JSON.stringify(docs));
const crawlStats = existsSync(`${opt.crawl}/stats.json`) ? JSON.parse(readFileSync(`${opt.crawl}/stats.json`, "utf8")) : {};
const meta: Meta = {
  docs: n,
  avgHead: avg(docs.lenHead),
  avgBody: avg(docs.lenBody),
  k1: K1,
  b: B,
  headWeight: HEAD_WEIGHT,
  prWeight: PR_WEIGHT,
  shards: SHARDS,
  terms: kept,
  built: new Date().toISOString(),
  crawl: { ...crawlStats, hostsInGraph: pr.hosts, pagerankIterations: pr.iterations },
  // Crawled hosts with the most PageRank, for the "about this index" view.
  topHosts: [...new Set(docs.host)]
    .map((h) => [h, pr.rank.get(h) ?? 0] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([h, r]) => [h, +r.toExponential(3)] as [string, number]),
};
writeFileSync(`${opt.out}/meta.json`, JSON.stringify(meta, null, 2));
writeFileSync(`${opt.crawl}/embed.jsonl`, embed.join("\n") + "\n");
console.log(`indexed ${n} docs, ${kept} terms (${postings.size - kept} dropped), ${pr.hosts} hosts in graph, PageRank ${pr.iterations} iterations`);
