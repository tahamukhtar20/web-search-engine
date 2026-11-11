// Runs searches in the browser against the static index, plus the semantic API.
import { capPerHost, fuse, parseQuery, rank, RRF_K, shardOf } from "../../search/core.ts";
import type { Docs, Meta, Query, Result, Shard } from "../../search/core.ts";

export type Mode = "keyword" | "semantic" | "combined";
export const MODES: { id: Mode; label: string; short: string }[] = [
  { id: "keyword", label: "BM25F + PageRank", short: "BM25F + PageRank" },
  { id: "semantic", label: "Semantic (bge-small)", short: "bge-small" },
  { id: "combined", label: "Combined (RRF)", short: "RRF" },
];

/** One shown result with whatever each method knows about it. */
export type Hit = {
  doc: number;
  /** Position in the list being shown, from 1. */
  rank: number;
  keyword: Result | null;
  keywordRank: number | null;
  cosine: number | null;
  semanticRank: number | null;
  rrf: number | null;
};

export type SearchResult = {
  query: Query;
  mode: Mode;
  hits: Hit[];
  /** Ranked lists before fusion (doc ids), for the merge chart. */
  keywordList: number[];
  semanticList: number[];
  candidates: number;
  shardsLoaded: number;
  ms: number;
  semanticError: string | null;
};

const LIST = 50;
let meta: Meta | null = null;
let docs: Docs | null = null;
const shardCache = new Map<number, Promise<Shard>>();

async function json<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function loadIndex(): Promise<{ meta: Meta; docs: Docs }> {
  if (!meta) meta = await json<Meta>("/index/meta.json");
  if (!docs) docs = await json<Docs>("/index/docs.json");
  return { meta, docs };
}

function shard(i: number): Promise<Shard> {
  if (!shardCache.has(i)) {
    // Forget a failed download so the next search tries again.
    const p = json<Shard>(`/index/t/${i}.json`).catch((e) => {
      shardCache.delete(i);
      throw e;
    });
    shardCache.set(i, p);
  }
  return shardCache.get(i)!;
}

async function semantic(q: string): Promise<{ id: number; score: number }[]> {
  const res = await fetch(`/api/semantic?q=${encodeURIComponent(q)}&k=${LIST}`);
  const body = (await res.json().catch(() => ({}))) as { results?: { id: number; score: number }[]; error?: string };
  if (!res.ok || !body.results) throw new Error(body.error ?? `semantic search failed (${res.status})`);
  return body.results;
}

export async function search(text: string, mode: Mode): Promise<SearchResult> {
  const t0 = performance.now();
  const { meta, docs } = await loadIndex();
  const query = parseQuery(text);

  const shardIds = [...new Set(query.terms.map((t) => shardOf(t, meta.shards)))];
  const [shards, sem] = await Promise.all([
    Promise.all(shardIds.map(shard)),
    mode === "keyword" ? Promise.resolve(null) : semantic(text).catch((e: Error) => e),
  ]);

  const postings = new Map<string, [number, number, number][]>();
  for (const s of shards) for (const t of query.terms) if (s[t]) postings.set(t, s[t]);
  const candidates = new Set([...postings.values()].flatMap((l) => l.map((p) => p[0]))).size;
  // Score everything that matched, then keep two pages per site so one site can't fill the page.
  const keyword = capPerHost(rank(query, postings, docs, meta, candidates || 1), docs).slice(0, LIST);
  const byDoc = new Map(keyword.map((r) => [r.doc, r]));
  const keywordList = keyword.map((r) => r.doc);

  const semanticError = sem instanceof Error ? sem.message : null;
  // Ignore ids outside this index (vectors left over from a bigger earlier build).
  const semResults = sem && !(sem instanceof Error) ? sem.filter((r) => r.id >= 0 && r.id < docs.url.length) : [];
  const semanticList = capPerHost(semResults.map((r) => ({ doc: r.id, score: r.score })), docs).map((r) => r.doc);
  const cosine = new Map(semResults.map((r) => [r.id, r.score]));

  let order: { doc: number; rrf: number | null }[];
  // If the semantic search failed, fall back to the keyword list rather than showing nothing.
  if (mode === "keyword" || (mode === "semantic" && semanticError)) order = keywordList.map((doc) => ({ doc, rrf: null }));
  else if (mode === "semantic") order = semanticList.map((doc) => ({ doc, rrf: null }));
  else order = capPerHost(fuse([keywordList, semanticList], RRF_K), docs).map((f) => ({ doc: f.doc, rrf: f.score }));

  const kwRank = new Map(keywordList.map((d, i) => [d, i + 1]));
  const semRank = new Map(semanticList.map((d, i) => [d, i + 1]));
  const hits: Hit[] = order.slice(0, 30).map((o, i) => ({
    doc: o.doc,
    rank: i + 1,
    keyword: byDoc.get(o.doc) ?? null,
    keywordRank: kwRank.get(o.doc) ?? null,
    cosine: cosine.get(o.doc) ?? null,
    semanticRank: semRank.get(o.doc) ?? null,
    rrf: o.rrf,
  }));

  return {
    query,
    mode,
    hits,
    keywordList,
    semanticList,
    candidates,
    shardsLoaded: shardIds.length,
    ms: Math.round(performance.now() - t0),
    semanticError,
  };
}
