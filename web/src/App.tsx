import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeXml, Search } from "lucide-react";
import type { Docs, Meta } from "../../search/core.ts";
import { About } from "./About.tsx";
import { RRF_K } from "../../search/core.ts";
import { loadIndex, MODES, search } from "./engine.ts";
import type { Mode, SearchResult } from "./engine.ts";
import { Why } from "./Why.tsx";

const REPO = "https://github.com/tahamukhtar20/web-search-engine";
const EXAMPLES = ["open source database", "how vaccines train the immune system", "cheap flights", "learn python", "climate change data"];
const PAGE = 10;

function readUrl(): { q: string; mode: Mode } {
  const p = new URLSearchParams(location.search);
  const mode = (p.get("mode") as Mode) ?? "combined";
  return { q: p.get("q") ?? "", mode: MODES.some((m) => m.id === mode) ? mode : "combined" };
}

export default function App() {
  const initial = useMemo(readUrl, []);
  const [input, setInput] = useState(initial.q);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [index, setIndex] = useState<{ meta: Meta; docs: Docs } | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last submitted query, and a counter so only the newest search may show its answer.
  const submitted = useRef(initial.q);
  const latest = useRef(0);

  useEffect(() => {
    loadIndex().then(setIndex, (e: Error) => setError(`Couldn't load the index: ${e.message}`));
  }, []);

  const run = useCallback(async (q: string, m: Mode, push = true) => {
    const text = q.trim();
    const id = ++latest.current;
    submitted.current = text;
    if (push) history.pushState(null, "", text ? `?q=${encodeURIComponent(text)}&mode=${m}` : location.pathname);
    setError(null);
    if (!text) {
      setBusy(false);
      return setResult(null);
    }
    setBusy(true);
    try {
      const r = await search(text, m);
      if (id !== latest.current) return;
      setResult(r);
      setSelected(0);
      setShown(PAGE);
    } catch (e) {
      if (id === latest.current) setError((e as Error).message);
    } finally {
      if (id === latest.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initial.q) run(initial.q, initial.mode, false);
    const onPop = () => {
      const { q, mode: m } = readUrl();
      setInput(q);
      setMode(m);
      run(q, m, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initial, run]);

  const pickMode = (m: Mode) => {
    setMode(m);
    if (submitted.current) run(submitted.current, m);
  };

  const hits = result?.hits ?? [];
  const hit = hits[selected];
  const panel =
    index && result && hit ? (
      <Why hit={hit} result={result} docs={index.docs} meta={index.meta} />
    ) : index && !result ? (
      <About meta={index.meta} docs={index.docs} />
    ) : null;

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="/" onClick={(e) => (e.preventDefault(), setInput(""), run("", mode))}>
          search<b>.</b>tahamukhtar
        </a>
        <form className="box" role="search" onSubmit={(e) => (e.preventDefault(), run(input, mode))}>
          <Search size={18} aria-hidden />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={index ? `Search ${index.meta.docs.toLocaleString()} pages` : "Search"} aria-label="Search" autoFocus />
        </form>
        <div className="seg" role="radiogroup" aria-label="Ranking method">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} aria-label={m.label} className={mode === m.id ? "on" : ""} onClick={() => pickMode(m.id)}>
              <span className="full">{m.label}</span>
              <span className="short">{m.short}</span>
            </button>
          ))}
        </div>
        <a className="src" href={REPO} aria-label="Source code on GitHub">
          <CodeXml size={18} />
        </a>
      </header>

      <div className="ticker mono">
        {index ? (
          <>
            <span><b>{index.meta.docs.toLocaleString()}</b> pages</span>
            <span><b>{index.meta.terms.toLocaleString()}</b> terms</span>
            {result && (
              <>
                <span><b>{result.shardsLoaded}</b>/{index.meta.shards} shards loaded</span>
                <span><b>{result.candidates.toLocaleString()}</b> candidates</span>
                <span><b>{result.ms}</b> ms</span>
              </>
            )}
            <span>BM25F k1 {index.meta.k1} · b {index.meta.b} · head ×{index.meta.headWeight} · PageRank ≤ +{Math.round(index.meta.prWeight * 100)}% · RRF k {RRF_K}</span>
          </>
        ) : (
          <span>Loading the index…</span>
        )}
      </div>

      <main className="grid">
        <section className="left" aria-busy={busy}>
          {error && <p className="err">{error}</p>}
          {!result ? (
            <div className="home">
              <p className="muted">Try one of these, or type your own:</p>
              <div className="examples">
                {EXAMPLES.map((q) => (
                  <button key={q} type="button" onClick={() => (setInput(q), run(q, mode))}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <p className="read mono">
                read as{" "}
                {result.query.words.map((w, i) =>
                  w.term === null ? (
                    <s key={i}>{w.word}</s>
                  ) : (
                    <span key={i}>
                      {w.word}
                      {w.term !== w.word && <em>{w.term}</em>}
                    </span>
                  ),
                )}
              </p>
              {result.semanticError && result.mode !== "keyword" && (
                <p className="note">
                  {result.semanticError}. {result.mode === "semantic" ? "Showing what the keyword index found instead." : "Showing the keyword ranking only."}
                </p>
              )}
              {hits.length === 0 ? (
                <p className="muted">No pages match. Try fewer or different words, or the semantic mode.</p>
              ) : (
                <ol className="results">
                  {hits.slice(0, shown).map((h, i) => (
                    <li key={h.doc} className={i === selected ? "sel" : ""}>
                      <button type="button" className="pick" onClick={() => setSelected(i)} aria-pressed={i === selected} aria-label={`Explain result ${i + 1}`}>
                        <span className="rk">{String(i + 1).padStart(2, "0")}</span>
                      </button>
                      <div className="bd" onClick={() => setSelected(i)}>
                        <div className="hostline mono">
                          <span>{index?.docs.host[h.doc]}</span>
                          <span className="pills">
                            {h.keywordRank && <i>kw {h.keywordRank}</i>}
                            {h.semanticRank && <i className="s">sem {h.semanticRank}</i>}
                          </span>
                        </div>
                        <a href={index?.docs.url[h.doc]} rel="noopener" onClick={(e) => e.stopPropagation()}>
                          {index?.docs.title[h.doc]}
                        </a>
                        <p>{index?.docs.description[h.doc]}</p>
                      </div>
                      {i === selected && panel && <div className="inline-why">{panel}</div>}
                    </li>
                  ))}
                </ol>
              )}
              {shown < hits.length && (
                <button type="button" className="more" onClick={() => setShown((s) => s + PAGE)}>
                  More results
                </button>
              )}
            </>
          )}
        </section>
        <aside className="right">{panel}</aside>
      </main>
    </div>
  );
}
