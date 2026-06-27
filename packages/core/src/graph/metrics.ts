import type {
  DependencyEdge,
  DependencyNode,
} from "@package-workbench/plugin-sdk";

/**
 * Computes per-node structural metrics in place: fan-in/out, degree, normalised
 * centrality, longest dependency depth, and transitive dependent/dependency
 * counts. Reachability is O(V·(V+E)); fine for realistic monorepos (hundreds of
 * packages). See the perf notes in the docs for very large graphs.
 */

export interface Adjacency {
  /** node id → set of node ids it depends on. */
  out: Map<string, Set<string>>;
  /** node id → set of node ids that depend on it. */
  in: Map<string, Set<string>>;
}

export function buildAdjacency(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
): Adjacency {
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  for (const n of nodes) {
    out.set(n.id, new Set());
    inn.set(n.id, new Set());
  }
  for (const e of edges) {
    if (e.from === e.to) continue;
    out.get(e.from)?.add(e.to);
    inn.get(e.to)?.add(e.from);
  }
  return { out, in: inn };
}

/** BFS reachable-set size from `start` over the given adjacency (excludes start). */
function reachableCount(start: string, adj: Map<string, Set<string>>): number {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next) && next !== start) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size;
}

/** Cycle-safe longest outgoing path length from each node. */
function longestDepths(
  nodes: DependencyNode[],
  out: Map<string, Set<string>>,
): Map<string, number> {
  const memo = new Map<string, number>();
  const stack = new Set<string>();
  const visit = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    let best = 0;
    for (const next of out.get(id) ?? [])
      best = Math.max(best, 1 + visit(next));
    stack.delete(id);
    memo.set(id, best);
    return best;
  };
  for (const n of nodes) visit(n.id);
  return memo;
}

/** Fill `node.metrics` and `node.isOrphan` for every node. Returns the adjacency. */
export function computeMetrics(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
): Adjacency {
  const adj = buildAdjacency(nodes, edges);
  const depths = longestDepths(nodes, adj.out);
  const maxDegree = Math.max(
    1,
    ...nodes.map(
      (n) => (adj.out.get(n.id)?.size ?? 0) + (adj.in.get(n.id)?.size ?? 0),
    ),
  );

  for (const n of nodes) {
    const fanOut = adj.out.get(n.id)?.size ?? 0;
    const fanIn = adj.in.get(n.id)?.size ?? 0;
    const degree = fanIn + fanOut;
    n.metrics = {
      fanIn,
      fanOut,
      degree,
      centrality: Math.round((degree / maxDegree) * 100) / 100,
      depth: depths.get(n.id) ?? 0,
      transitiveDependents: reachableCount(n.id, adj.in),
      transitiveDependencies: reachableCount(n.id, adj.out),
    };
    n.isOrphan = degree === 0;
  }
  return adj;
}
