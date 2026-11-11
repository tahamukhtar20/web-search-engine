// Embed every indexed page into Vectorize through the ingest Worker.
//   1. wrangler dev --remote -c semantic/wrangler.ingest.jsonc --port 8799
//   2. node semantic/ingest.ts data/crawl/embed.jsonl
// Resumable: finished batch numbers are written to data/crawl/ingest-progress.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [file = "data/crawl/embed.jsonl", endpoint = "http://localhost:8799/ingest"] = process.argv.slice(2);
const BATCH = 50;
const CHARS = 800; // bge-small reads up to 512 tokens; the start of a page carries most of its meaning

const rows = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { id: number; text: string })
  .map((r) => ({ id: r.id, text: r.text.replace(/\s+/g, " ").slice(0, CHARS) }));

const progressFile = file.replace(/[^/]+$/, "ingest-progress.json");
const done = new Set<number>(existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, "utf8")) : []);
const batches = Math.ceil(rows.length / BATCH);
console.log(`${rows.length} pages, ${batches} batches, ${done.size} already done`);

for (let b = 0; b < batches; b++) {
  if (done.has(b)) continue;
  const items = rows.slice(b * BATCH, (b + 1) * BATCH);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(items) });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      break;
    } catch (e) {
      if (attempt >= 5) throw e;
      console.log(`batch ${b} attempt ${attempt} failed: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  done.add(b);
  writeFileSync(progressFile, JSON.stringify([...done]));
  if (b % 20 === 0) console.log(`batch ${b + 1}/${batches}`);
}
console.log("done");
