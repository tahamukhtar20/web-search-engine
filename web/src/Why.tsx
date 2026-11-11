// "Why it ranks here": the score breakdown for one result in the current mode.
import type { Docs, Meta } from "../../search/core.ts";
import { RRF_K } from "../../search/core.ts";
import type { Hit, SearchResult } from "./engine.ts";

const f2 = (x: number) => x.toFixed(2);

export function Why({ hit, result, docs, meta }: { hit: Hit; result: SearchResult; docs: Docs; meta: Meta }) {
  const showKeyword = result.mode !== "semantic" || !!hit.keyword;
  const showSemantic = result.mode !== "keyword";
  return (
    <div className="why">
      <h2>
        Why <i>{docs.host[hit.doc]}</i> ranks {hit.rank === 1 ? "first" : `#${hit.rank}`}
      </h2>
      <div className="why-url mono">{docs.url[hit.doc]}</div>

      {showKeyword && <KeywordScore hit={hit} meta={meta} />}
      {showSemantic && <SemanticScore hit={hit} error={result.semanticError} />}
      {result.mode === "combined" && <Merge hit={hit} result={result} docs={docs} />}
    </div>
  );
}

function KeywordScore({ hit, meta }: { hit: Hit; meta: Meta }) {
  const k = hit.keyword;
  return (
    <section>
      <div className="lab">
        Keyword score <span>BM25F × PageRank</span>
      </div>
      {!k ? (
        <p className="muted small">No query term appears on this page; it was found by meaning alone.</p>
      ) : (
        <>
          <div className="eq">
            <div className="blks">
              {k.terms.map((t) => (
                <div key={t.term} className="blk" style={{ flex: Math.max(t.score, 0.35) }}>
                  <span className="bv">{f2(t.score)}</span>
                  <span className="bt">{t.term}</span>
                </div>
              ))}
            </div>
            <div className="op">+</div>
            <div className="pr">
              <span className="bv">+{f2(k.score - k.bm25)}</span>
              <span className="bt">PageRank {f2(k.prBoost)}</span>
            </div>
          </div>
          <div className="res mono">
            {k.terms.map((t) => f2(t.score)).join(" + ")} = <b>{f2(k.bm25)}</b> × (1 + {meta.prWeight} × {f2(k.prBoost)}) ={" "}
            <b>{f2(k.score)}</b>
          </div>
          <div className="terms mono">
            {k.terms.map((t) => (
              <div key={t.term} className="trow">
                <b>{t.term}</b>
                <span>
                  title/headings {t.tfHead}× · text {t.tfBody}×
                </span>
                <span>df {t.df.toLocaleString()}</span>
                <span>idf {f2(t.idf)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function SemanticScore({ hit, error }: { hit: Hit; error: string | null }) {
  return (
    <section>
      <div className="lab">
        Semantic score <span>bge-small · cosine</span>
      </div>
      {error ? (
        <p className="muted small">{error}</p>
      ) : hit.cosine === null ? (
        <p className="muted small">Not among the 50 pages closest in meaning to the query.</p>
      ) : (
        <div className="cos">
          <div className="track">
            <span style={{ width: `${Math.max(0, hit.cosine) * 100}%` }} />
          </div>
          <span className="v mono">{hit.cosine.toFixed(2)}</span>
        </div>
      )}
    </section>
  );
}

const ROW = 30;
const SHOWN = 8;
// Label rows by site: page titles are often just "Home" or "News".
const short = (host: string) => {
  const s = host.replace(/^www\./, "");
  return s.length <= 15 ? s : `${s.slice(0, 14)}…`;
};

function Merge({ hit, result, docs }: { hit: Hit; result: SearchResult; docs: Docs }) {
  const fused = result.hits.slice(0, SHOWN);
  const kw = result.keywordList.slice(0, SHOWN);
  const sem = result.semanticList.slice(0, SHOWN);
  const rows = Math.max(fused.length, kw.length, sem.length, 1);
  const y = (i: number) => 14 + i * ROW;
  const line = (from: number, to: number, x1: number, x2: number, hot: boolean, key: string) => (
    <path
      key={key}
      d={`M${x1} ${y(from)} C ${x1 + 42} ${y(from)}, ${x2 - 42} ${y(to)}, ${x2} ${y(to)}`}
      className={hot ? "ln hot" : "ln"}
    />
  );
  const lines = fused.flatMap((h, i) => [
    kw.indexOf(h.doc) >= 0 ? line(kw.indexOf(h.doc), i, 122, 214, h.doc === hit.doc, `k${h.doc}`) : null,
    sem.indexOf(h.doc) >= 0 ? line(i, sem.indexOf(h.doc), 266, 358, h.doc === hit.doc, `s${h.doc}`) : null,
  ]);
  const term = (r: number | null) => (r ? `1/(${RRF_K} + ${r})` : "0");
  return (
    <section>
      <div className="lab">
        How the two lists merge <span>reciprocal rank fusion</span>
      </div>
      <div className="cols mono">
        <span>keyword rank</span>
        <span>combined</span>
        <span>semantic rank</span>
      </div>
      <svg className="bump" viewBox={`0 0 480 ${rows * ROW}`} width="100%" role="img" aria-label="How keyword and semantic rankings merge">
        {lines}
        {kw.map((d, i) => (
          <text key={d} x={114} y={y(i) + 4} textAnchor="end" className={d === hit.doc ? "hot" : ""}>
            {short(docs.host[d])}
          </text>
        ))}
        {fused.map((h, i) => (
          <text key={h.doc} x={240} y={y(i) + 5} textAnchor="middle" className={`fn ${h.doc === hit.doc ? "hot" : ""}`}>
            {i + 1}
          </text>
        ))}
        {sem.map((d, i) => (
          <text key={d} x={366} y={y(i) + 4} textAnchor="start" className={d === hit.doc ? "hot" : ""}>
            {short(docs.host[d])}
          </text>
        ))}
      </svg>
      <div className="res mono">
        {term(hit.keywordRank)} + {term(hit.semanticRank)} = <b>{hit.rrf?.toFixed(4)}</b>
      </div>
    </section>
  );
}
