// PageRank by power iteration over a directed host graph. Dangling hosts (no out-links)
// spread their rank evenly, so ranks always sum to 1.

export function pagerank(edges: Map<string, Map<string, number>>, damping = 0.85, tol = 1e-10, maxIter = 100) {
  const ids = new Map<string, number>();
  const id = (h: string) => ids.get(h) ?? (ids.set(h, ids.size), ids.size - 1);
  for (const [from, outs] of edges) {
    id(from);
    for (const to of outs.keys()) id(to);
  }
  const n = ids.size;
  // Each host's out-links count once per target, weighted by how many pages link there.
  const out: { to: number; w: number }[][] = Array.from({ length: n }, () => []);
  const outWeight = new Float64Array(n);
  for (const [from, outs] of edges) {
    const f = id(from);
    for (const [to, w] of outs) {
      out[f].push({ to: id(to), w });
      outWeight[f] += w;
    }
  }
  let rank = new Float64Array(n).fill(1 / n);
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const next = new Float64Array(n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (outWeight[i] === 0) dangling += rank[i];
      else for (const { to, w } of out[i]) next[to] += (damping * rank[i] * w) / outWeight[i];
    }
    const base = (1 - damping) / n + (damping * dangling) / n;
    let delta = 0;
    for (let i = 0; i < n; i++) {
      next[i] += base;
      delta += Math.abs(next[i] - rank[i]);
    }
    rank = next;
    if (delta < tol) break;
  }
  const byHost = new Map<string, number>();
  for (const [h, i] of ids) byHost.set(h, rank[i]);
  return { rank: byHost, iterations, hosts: n };
}
