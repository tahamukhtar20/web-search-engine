// Serves the static search site and answers semantic queries:
//   GET /api/semantic?q=...&k=50  ->  { results: [{ id, score }] }
// The query is embedded with the same model the pages were embedded with, then the
// nearest pages come from Vectorize. Everything else is a static asset.
// Answers are cached at the edge and each visitor is rate limited, since every
// uncached query costs an embedding call and a vector search.

type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  AI: { run: (model: string, input: { text: string[] }) => Promise<{ data: number[][] }> };
  VECTORIZE: { query: (vector: number[], options: { topK: number }) => Promise<{ matches: { id: string; score: number }[] }> };
  LIMITER: { limit: (options: { key: string }) => Promise<{ success: boolean }> };
};
type Ctx = { waitUntil: (p: Promise<unknown>) => void };

const MODEL = "@cf/baai/bge-small-en-v1.5";
const MAX_QUERY = 200;
const MAX_K = 50;

const error = (message: string, status: number) => Response.json({ error: message }, { status });

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/semantic") return env.ASSETS.fetch(request);
    if (request.method !== "GET") return error("use GET", 405);

    const q = (url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_QUERY);
    const k = Math.min(Math.max(Math.trunc(Number(url.searchParams.get("k"))) || MAX_K, 1), MAX_K);
    if (!q) return error("missing q", 400);

    // One cache entry per normalised query, whatever else the URL carried.
    const key = new Request(`${url.origin}/api/semantic?q=${encodeURIComponent(q)}&k=${k}`);
    const cache = (caches as unknown as { default: Cache }).default;
    const hit = await cache.match(key);
    if (hit) return hit;

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await env.LIMITER.limit({ key: ip })).success) return error("too many searches, try again in a minute", 429);

    try {
      const { data } = await env.AI.run(MODEL, { text: [q] });
      const { matches } = await env.VECTORIZE.query(data[0], { topK: k });
      const res = Response.json(
        { results: matches.map((m) => ({ id: Number(m.id), score: +m.score.toFixed(4) })) },
        { headers: { "cache-control": "public, max-age=86400" } },
      );
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (e) {
      console.error("semantic search failed", e);
      return error("semantic search is unavailable right now", 503);
    }
  },
};
