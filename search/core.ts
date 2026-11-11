// Ranking shared by the index builder (for tests) and the browser: BM25F over two fields
// (head = title, description, h1/h2; body = page text) plus a PageRank boost.
import { murmur3 } from "../crawler/bloom.ts";
import { explainQuery } from "../crawler/text.ts";

export type Meta = {
  docs: number;
  avgHead: number;
  avgBody: number;
  k1: number;
  b: number;
  headWeight: number;
  /** final = bm25 × (1 + prWeight × prBoost), prBoost in [0, 1]. */
  prWeight: number;
  shards: number;
  terms: number;
  built: string;
  crawl: Record<string, unknown>;
};

/** Column-wise document table, so the JSON stays small. */
export type Docs = {
  url: string[];
  title: string[];
  description: string[];
  host: string[];
  lenHead: number[];
  lenBody: number[];
  /** PageRank of the document's host, scaled to [0, 1] on a log scale. */
  prBoost: number[];
};

/** term → [docId, tfHead, tfBody][] */
export type Shard = Record<string, [number, number, number][]>;

export const shardOf = (term: string, shards: number) => murmur3(term, 7) % shards;

export const idf = (n: number, df: number) => Math.log(1 + (n - df + 0.5) / (df + 0.5));

export type TermScore = { term: string; df: number; idf: number; tfHead: number; tfBody: number; score: number };
export type Result = { doc: number; bm25: number; prBoost: number; score: number; terms: TermScore[] };

export type Query = { words: { word: string; term: string | null }[]; terms: string[] };

export function parseQuery(text: string): Query {
  const words = explainQuery(text);
  return { words, terms: [...new Set(words.map((w) => w.term).filter((t): t is string => !!t))] };
}

/** Score every document that contains at least one query term. */
export function rank(query: Query, postings: Map<string, [number, number, number][]>, docs: Docs, meta: Meta, limit = 20): Result[] {
  const { k1, b, headWeight, avgHead, avgBody } = meta;
  const acc = new Map<number, TermScore[]>();
  for (const term of query.terms) {
    const list = postings.get(term);
    if (!list) continue;
    const termIdf = idf(meta.docs, list.length);
    for (const [doc, tfHead, tfBody] of list) {
      // BM25F: length-normalise each field, weight and sum, then saturate once.
      const nh = tfHead / (1 - b + (b * docs.lenHead[doc]) / avgHead);
      const nb = tfBody / (1 - b + (b * docs.lenBody[doc]) / avgBody);
      const tf = headWeight * nh + nb;
      const score = (termIdf * tf * (k1 + 1)) / (tf + k1);
      const list2 = acc.get(doc) ?? [];
      list2.push({ term, df: list.length, idf: termIdf, tfHead, tfBody, score });
      acc.set(doc, list2);
    }
  }
  const results: Result[] = [];
  for (const [doc, terms] of acc) {
    const bm25 = terms.reduce((s, t) => s + t.score, 0);
    const prBoost = docs.prBoost[doc];
    results.push({ doc, bm25, prBoost, score: bm25 * (1 + meta.prWeight * prBoost), terms });
  }
  return results.sort((x, y) => y.score - x.score).slice(0, limit);
}
