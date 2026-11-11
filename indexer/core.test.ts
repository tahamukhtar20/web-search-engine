import { test } from "node:test";
import assert from "node:assert/strict";
import { BloomFilter, murmur3 } from "../crawler/bloom.ts";
import { extract, looksEnglish } from "../crawler/extract.ts";
import { isChallenge } from "../crawler/fetch.ts";
import { terms } from "../crawler/text.ts";
import { idf, parseQuery, rank } from "../search/core.ts";
import type { Docs, Meta } from "../search/core.ts";
import { pagerank } from "./pagerank.ts";

test("murmur3 matches reference values", () => {
  // Reference outputs of MurmurHash3_x86_32.
  assert.equal(murmur3("", 0), 0);
  assert.equal(murmur3("", 1), 0x514e28b7);
  assert.equal(murmur3("hello", 0), 0x248bfa47);
  assert.equal(murmur3("The quick brown fox jumps over the lazy dog", 0), 0x2e4ff723);
});

test("bloom filter has no false negatives and a false-positive rate near target", () => {
  const f = new BloomFilter(10_000, 0.01);
  for (let i = 0; i < 10_000; i++) f.add(`https://site${i}.example/`);
  for (let i = 0; i < 10_000; i++) assert.ok(f.has(`https://site${i}.example/`));
  let fp = 0;
  for (let i = 0; i < 20_000; i++) if (f.has(`https://other${i}.example/`)) fp++;
  assert.ok(fp / 20_000 < 0.02, `false-positive rate ${fp / 20_000}`);
  assert.ok(f.addIfNew("new") && !f.addIfNew("new"));
});

test("terms drop stop words and stem", () => {
  assert.deepEqual(terms("The Running of the Bulls, 2024!"), ["run", "bull", "2024"]);
  assert.deepEqual(terms("café naïve"), ["cafe", "naiv"]);
  assert.deepEqual(terms("call 0123456789 now"), ["call"]);
});

test("extract pulls title, description, headings, body and absolute links", () => {
  const html = `<html lang="en"><head><title> Hello </title><meta name="description" content="A page"></head>
    <body><nav><a href="/menu">Menu</a></nav><h1>Big heading</h1><p>First paragraph text here.</p>
    <script>var x = 1</script><a href="https://other.org/x#frag">o</a><a href="mailto:a@b.c">m</a></body></html>`;
  const e = extract(html, "https://site.org/page");
  assert.equal(e.title, "Hello");
  assert.equal(e.description, "A page");
  assert.equal(e.headings, "Big heading");
  assert.match(e.body, /First paragraph text here/);
  assert.doesNotMatch(e.body, /var x/);
  assert.deepEqual(e.links.sort(), ["https://other.org/x", "https://site.org/menu"]);
  assert.ok(looksEnglish(e));
});

test("bot challenges are recognised", () => {
  assert.ok(isChallenge("Just a moment...", ""));
  assert.ok(isChallenge("", "Please verify you are human"));
  assert.ok(!isChallenge("Captcha research at MIT", "x".repeat(2000)));
});

test("pagerank sums to one and favours linked-to hosts", () => {
  const e = new Map([
    ["a", new Map([["c", 1]])],
    ["b", new Map([["c", 1]])],
    ["c", new Map([["a", 1]])],
  ]);
  const { rank: r } = pagerank(e);
  const sum = [...r.values()].reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(r.get("c")! > r.get("a")! && r.get("a")! > r.get("b")!);
});

test("BM25F prefers head matches and rarer terms; PageRank breaks ties", () => {
  const docs: Docs = {
    url: ["u0", "u1", "u2"],
    title: ["", "", ""],
    description: ["", "", ""],
    host: ["a", "b", "c"],
    lenHead: [5, 5, 5],
    lenBody: [100, 100, 100],
    prBoost: [0, 0, 1],
  };
  const meta: Meta = { docs: 3, avgHead: 5, avgBody: 100, k1: 1.2, b: 0.75, headWeight: 2, prWeight: 0.3, shards: 1, terms: 1, built: "", crawl: {} };
  const postings = new Map<string, [number, number, number][]>([["crawler", [[0, 1, 0], [1, 0, 1], [2, 0, 1]]]]);
  const r = rank(parseQuery("crawlers"), postings, docs, meta);
  assert.equal(r[0].doc, 0, "head match first");
  assert.equal(r[1].doc, 2, "PageRank breaks the body-only tie");
  assert.ok(idf(1000, 1) > idf(1000, 500));
});
