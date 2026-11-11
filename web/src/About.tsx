// Shown before the first search: what is in the index and how it was built.
import type { Docs, Meta } from "../../search/core.ts";

const OUTCOMES: [string, string][] = [
  ["ok", "Indexed"],
  ["non-english", "Not English"],
  ["robots-unreachable", "robots.txt unreachable"],
  ["refused-403", "Refused (403)"],
  ["empty", "Too little text"],
  ["blocked", "Filtered as unsafe"],
  ["error", "Fetch failed"],
  ["robots", "Disallowed by robots.txt"],
];

export function About({ meta, docs }: { meta: Meta; docs: Docs }) {
  const c = meta.crawl as { hosts?: number; rendered?: number; statuses?: Record<string, number>; finished?: string };
  const statuses = c.statuses ?? {};
  const maxStatus = Math.max(...OUTCOMES.map(([k]) => statuses[k] ?? 0), 1);
  const top = meta.topHosts ?? [];
  const maxPr = top[0]?.[1] ?? 1;
  const sites = new Set(docs.host).size;
  return (
    <div className="why about">
      <h2>
        What's <i>in here</i>
      </h2>
      <p className="lead">
        {meta.docs.toLocaleString()} pages from {sites.toLocaleString()} sites, crawled from the Tranco top-sites list
        {c.finished ? ` on ${new Date(c.finished).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}.
        The crawler reads robots.txt, waits between requests to a site and renders JavaScript-built pages in headless Chrome
        {c.rendered ? ` (${c.rendered.toLocaleString()} of them)` : ""}.
      </p>

      <section>
        <div className="lab">
          What happened to each site <span>{(c.hosts ?? 0).toLocaleString()} sites tried</span>
        </div>
        <div className="bars">
          {OUTCOMES.map(([k, label]) => (
            <div key={k} className="bar-row">
              <span>{label}</span>
              <span className="track">
                <span style={{ width: `${((statuses[k] ?? 0) / maxStatus) * 100}%` }} />
              </span>
              <span className="mono">{(statuses[k] ?? 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="lab">
          Highest PageRank <span>over links between {(meta.crawl.hostsInGraph as number).toLocaleString()} hosts</span>
        </div>
        <div className="bars">
          {top.slice(0, 12).map(([h, pr]) => (
            <div key={h} className="bar-row">
              <span className="mono">{h}</span>
              <span className="track rank">
                <span style={{ width: `${(pr / maxPr) * 100}%` }} />
              </span>
              <span className="mono">{pr.toExponential(1)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="lab">How a query is answered</div>
        <ol className="how">
          <li>The query is lowercased, stop words are dropped and the rest is Porter-stemmed.</li>
          <li>Only the index shards holding those terms are downloaded ({meta.shards} shards in all).</li>
          <li>
            BM25F scores each page (k1 {meta.k1}, b {meta.b}, title and headings weighted {meta.headWeight}×), then PageRank
            adds up to {Math.round(meta.prWeight * 100)}%.
          </li>
          <li>The semantic list comes from bge-small embeddings and cosine similarity in Vectorize.</li>
          <li>Combined mode merges the two lists with reciprocal rank fusion and keeps two pages per site.</li>
        </ol>
      </section>
    </div>
  );
}
