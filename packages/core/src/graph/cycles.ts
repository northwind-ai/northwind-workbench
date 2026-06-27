import type {
  CircularDependencyReport,
  CycleSeverity,
  DependencyEdge,
  DependencyNode,
} from "@package-workbench/plugin-sdk";

/**
 * Circular-dependency detection via Tarjan's strongly-connected-components
 * algorithm (linear, O(V+E)). Each non-trivial SCC (or self-loop) is a cycle; we
 * extract a representative loop path and grade severity by size + centrality.
 */

/** Tarjan SCC — returns the components with more than one node, plus self-loops. */
export function stronglyConnectedComponents(
  nodeIds: string[],
  out: Map<string, Set<string>>,
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  // Iterative Tarjan to avoid stack overflow on deep graphs.
  for (const start of nodeIds) {
    if (indices.has(start)) continue;
    const work: Array<{ node: string; iter: Iterator<string> }> = [
      { node: start, iter: (out.get(start) ?? new Set()).values() },
    ];
    indices.set(start, index);
    low.set(start, index);
    index++;
    stack.push(start);
    onStack.add(start);

    while (work.length) {
      const frame = work[work.length - 1]!;
      const next = frame.iter.next();
      if (!next.done) {
        const w = next.value;
        if (!indices.has(w)) {
          indices.set(w, index);
          low.set(w, index);
          index++;
          stack.push(w);
          onStack.add(w);
          work.push({ node: w, iter: (out.get(w) ?? new Set()).values() });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, indices.get(w)!));
        }
      } else {
        if (low.get(frame.node) === indices.get(frame.node)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== frame.node);
          sccs.push(comp);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1]!.node;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
        }
      }
    }
  }
  return sccs;
}

/** Find one representative cycle path within a set of SCC member ids. */
function extractCyclePath(
  members: Set<string>,
  out: Map<string, Set<string>>,
): string[] {
  const start = [...members][0]!;
  const path: string[] = [];
  const onPath = new Set<string>();
  const dfs = (node: string): string[] | null => {
    path.push(node);
    onPath.add(node);
    for (const next of out.get(node) ?? []) {
      if (!members.has(next)) continue;
      if (onPath.has(next)) {
        // Close the loop at `next`.
        return path.slice(path.indexOf(next));
      }
      const found = dfs(next);
      if (found) return found;
    }
    path.pop();
    onPath.delete(node);
    return null;
  };
  return dfs(start) ?? [start];
}

function severityFor(size: number, maxCentrality: number): CycleSeverity {
  let base: CycleSeverity =
    size <= 1
      ? "medium"
      : size === 2
        ? "high"
        : size <= 4
          ? "high"
          : "critical";
  if (maxCentrality > 0.5 && base !== "critical") {
    base = base === "high" ? "critical" : "high";
  }
  return base;
}

/** Detect all cycles (self, direct, indirect) in the graph. */
export function detectCycles(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
): CircularDependencyReport[] {
  const out = new Map<string, Set<string>>(
    nodes.map((n) => [n.id, new Set<string>()]),
  );
  const selfLoops = new Set<string>();
  for (const e of edges) {
    if (e.from === e.to) selfLoops.add(e.from);
    else out.get(e.from)?.add(e.to);
  }
  const centrality = new Map(nodes.map((n) => [n.id, n.metrics.centrality]));
  const reports: CircularDependencyReport[] = [];

  // Self cycles.
  for (const id of selfLoops) {
    reports.push({
      cycle: [id],
      kind: "self",
      severity: "medium",
      affected: [id],
    });
  }

  // Multi-node SCCs.
  for (const comp of stronglyConnectedComponents(
    nodes.map((n) => n.id),
    out,
  )) {
    if (comp.length < 2) continue;
    const members = new Set(comp);
    const path = extractCyclePath(members, out);
    const maxCentrality = Math.max(
      0,
      ...comp.map((id) => centrality.get(id) ?? 0),
    );
    reports.push({
      cycle: path,
      kind: path.length === 2 ? "direct" : "indirect",
      severity: severityFor(comp.length, maxCentrality),
      affected: comp.sort(),
    });
  }

  // Stable ordering: worst first.
  const rank: Record<CycleSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return reports.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      b.affected.length - a.affected.length,
  );
}
