// One-off ingest Worker, run with `wrangler dev --remote -c semantic/wrangler.ingest.jsonc`.
// POST /ingest with [{id, text}] embeds the texts with Workers AI and upserts them into
// the Vectorize index. Never deployed; it only runs while the local ingest script needs it.
const MODEL = "@cf/baai/bge-small-en-v1.5";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/ingest") return new Response("not found", { status: 404 });
    const items = await request.json();
    const { data } = await env.AI.run(MODEL, { text: items.map((i) => i.text) });
    const vectors = items.map((item, k) => ({ id: String(item.id), values: data[k] }));
    const result = await env.VECTORIZE.upsert(vectors);
    return Response.json({ upserted: vectors.length, mutationId: result.mutationId ?? null });
  },
};
