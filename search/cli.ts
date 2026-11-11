// Query a built index from the command line: node search/cli.ts <index dir> "query words"
import { readFileSync } from "node:fs";
import { parseQuery, rank, shardOf } from "./core.ts";
import type { Docs, Meta, Shard } from "./core.ts";

const [dir, ...q] = process.argv.slice(2);
const meta: Meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8"));
const docs: Docs = JSON.parse(readFileSync(`${dir}/docs.json`, "utf8"));
const query = parseQuery(q.join(" "));
const postings = new Map<string, [number, number, number][]>();
for (const t of query.terms) {
  const shard: Shard = JSON.parse(readFileSync(`${dir}/t/${shardOf(t, meta.shards)}.json`, "utf8"));
  if (shard[t]) postings.set(t, shard[t]);
}
console.log("query:", query.words.map((w) => `${w.word}→${w.term ?? "(stop)"}`).join(" "));
for (const r of rank(query, postings, docs, meta, 5))
  console.log(`${r.score.toFixed(2)}  bm25=${r.bm25.toFixed(2)} pr=${r.prBoost.toFixed(2)}  ${docs.title[r.doc].slice(0, 60)}  ${docs.url[r.doc]}`);
