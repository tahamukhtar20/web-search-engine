# Web Search Engine

A small web search engine built end to end: a crawler that starts from the most popular domains on the web, an inverted index with BM25F ranking, PageRank over the link graph between sites, and semantic search with sentence embeddings.

Live at [search.tahamukhtar.com](https://search.tahamukhtar.com). Every result can be opened to see why it ranks where it does: the BM25F score per term, the PageRank boost, the embedding similarity, and how the two rankings were merged.

## Crawler

`crawler/crawl.ts` crawls breadth-first from the [Tranco](https://tranco-list.eu) top-sites list.

- Each worker takes one host at a time: it reads robots.txt, fetches the home page, then up to three internal pages with at least 1.5 s between requests (longer if the site sets a crawl delay).
- Hosts are checked against Cloudflare's family-safe resolver first, so adult and malware domains in the seed list are skipped.
- Pages whose content is built by JavaScript are rendered in headless Chrome, with images, media, fonts and stylesheets blocked.
- A site that answers 403, 429 or 503, or serves a bot challenge, is left alone.
- Seen URLs and hosts are tracked in a Bloom filter (MurmurHash3 with double hashing, sized for a 0.1% false-positive rate).
- Links to other hosts feed both the crawl frontier and the host graph used for PageRank.

Each page keeps its title, description, h1/h2 headings and readable body text. Scripts, navigation, footers and forms are removed first.

## Index and ranking

`indexer/build.ts` turns a crawl into a static index:

- Text is lowercased, split, filtered against an English stop-word list and Porter-stemmed (`crawler/text.ts`).
- Two fields are indexed: head (title, description, headings) and body.
- Ranking is BM25F (k1 = 1.2, b = 0.75, head weighted 2×), multiplied by a PageRank boost of up to 30%. PageRank runs on the host link graph (damping 0.85, power iteration until the change is below 1e-10).
- Postings are split into 128 shards by term hash, so a query only downloads the shards for its terms.

`search/core.ts` holds the ranking used by both the tests and the site. `node search/cli.ts <index dir> "some query"` searches a built index from the terminal.

## Semantic search

Each page's title, description, headings and the start of its text (800 characters) are embedded with [bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) (384 dimensions) on Workers AI and stored in a Cloudflare Vectorize index with cosine distance. A query is embedded with the same model and the 50 nearest pages come back.

The site offers three modes:

- BM25F + PageRank: the keyword ranking above.
- Semantic (bge-small): nearest pages by embedding.
- Combined (RRF), the default: the two lists merged with reciprocal rank fusion, where each list adds 1 / (60 + rank) for every page it ranks, keeping at most two pages per site.

## The site

`web/` is a React app that runs the keyword ranking in the browser against the static index, downloading only the shards a query needs. `worker/index.ts` is a Cloudflare Worker that serves the site and answers `GET /api/semantic?q=...`. Semantic answers are cached at the edge and limited to 30 uncached searches a minute per visitor.

```bash
npm run build                                     # type-check and build web/dist
npx wrangler dev                                  # site and API locally, using the real AI and Vectorize bindings
npx wrangler deploy
```

To load the embeddings after building a new index:

```bash
npx wrangler vectorize create web-search --dimensions 384 --metric cosine
npx wrangler dev --remote -c semantic/wrangler.ingest.jsonc --port 8799
node semantic/ingest.ts data/crawl/embed.jsonl    # resumable; progress in data/crawl/ingest-progress.json
```

The ingest only adds and overwrites vectors. If a new index has fewer pages than the old one, recreate the Vectorize index and delete the progress file first.

## Running a crawl

The crawl runs on GitHub Actions (`.github/workflows/crawl.yml`, started by hand). It downloads the current Tranco list, crawls, builds the index and uploads two artifacts: `index` (what the site serves) and `crawl` (pages, host graph and statistics).

Locally, with Node 22.18 or newer and Google Chrome installed:

```bash
npm install
npm test
node crawler/crawl.ts --seeds seeds.csv --out data/crawl --max-pages 200
node indexer/build.ts --crawl data/crawl --out web/public/index
node search/cli.ts web/public/index "open source"
```

`seeds.csv` is either the Tranco CSV (`rank,domain`) or one domain per line.

## Data

The seed list is from Tranco: Le Pochat et al., "Tranco: A Research-Oriented Top Sites Ranking Hardened Against Manipulation", NDSS 2019. The published index holds each page's URL, title, a short description and its index terms, not the pages' full text.

## History

The first version (2024), built together with Muhammad Sunaam, used Puppeteer for every page, a Python TF-IDF indexer with Apache Solr, a BERT re-ranker served from Flask, and PageRank computed separately in notebooks. This version rewrites it in TypeScript with the ranking signals combined in one place.

## License

[MIT](LICENSE). The seed list is Tranco's; crawled page titles and descriptions belong to their sites.
