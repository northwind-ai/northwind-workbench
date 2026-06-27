import { relative } from "node:path";
import type {
  DependencyGraph,
  PackageInfo,
} from "@package-workbench/plugin-sdk";
import type { BlastRadius, ChangedPackage } from "./types";

/**
 * Changed-package detection + dependency-aware blast radius. Determining "what
 * does this PR actually affect?" is *not* just the files that changed — editing a
 * low-level package ripples to everything that transitively depends on it. This
 * module attributes changed files to packages, then walks the dependency graph
 * *backwards* to find the full impacted set.
 *
 * Pure + deterministic given the graph + file list.
 */

/** Normalize a path to forward slashes with no trailing slash. */
function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Attribute each changed file to the package that owns it (longest matching
 * package root wins, so a nested package beats its parent). Files outside every
 * package (root configs, CI) are ignored for package attribution.
 */
export function attributeFiles(
  packages: PackageInfo[],
  workspaceRoot: string,
  changedFiles: string[],
): Map<string, string[]> {
  const roots = packages
    .map((p) => ({ id: p.id, rel: norm(relative(workspaceRoot, p.root)) }))
    .sort((a, b) => b.rel.length - a.rel.length); // longest (most specific) first

  const byPkg = new Map<string, string[]>();
  for (const raw of changedFiles) {
    const file = norm(raw);
    const owner = roots.find(
      (r) => r.rel === "" || file === r.rel || file.startsWith(r.rel + "/"),
    );
    if (!owner) continue;
    const list = byPkg.get(owner.id) ?? [];
    list.push(raw);
    byPkg.set(owner.id, list);
  }
  return byPkg;
}

/** Build reverse adjacency: for each package, the set of direct dependents. */
function reverseAdjacency(
  graph: Pick<DependencyGraph, "edges">,
): Map<string, Set<string>> {
  const rev = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.from === e.to) continue;
    // `from` depends on `to` ⇒ `from` is a dependent of `to`.
    if (!rev.has(e.to)) rev.set(e.to, new Set());
    rev.get(e.to)!.add(e.from);
  }
  return rev;
}

/**
 * Every package that transitively depends on any of `ids` (excluding `ids`
 * themselves). Cycle-safe via a visited set.
 */
export function transitiveDependents(
  graph: Pick<DependencyGraph, "edges">,
  ids: string[],
): Set<string> {
  const rev = reverseAdjacency(graph);
  const seed = new Set(ids);
  const impacted = new Set<string>();
  const queue = [...ids];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const dependent of rev.get(cur) ?? []) {
      if (impacted.has(dependent)) continue;
      impacted.add(dependent);
      queue.push(dependent);
    }
  }
  for (const id of seed) impacted.delete(id);
  return impacted;
}

/** Compute the blast radius for a set of directly-edited package ids. */
export function computeBlastRadius(
  graph: DependencyGraph,
  editedIds: string[],
): BlastRadius {
  const edited = [...new Set(editedIds)].filter((id) =>
    graph.nodes.some((n) => n.id === id),
  );
  const impactedSet = transitiveDependents(graph, edited);
  const impacted = [...impactedSet].sort();
  const totalSet = new Set([...edited, ...impacted]);

  const byPackage = edited
    .map((id) => ({
      id,
      impacted: [...transitiveDependents(graph, [id])].sort(),
    }))
    .sort((a, b) => b.impacted.length - a.impacted.length);

  return {
    edited: [...edited].sort(),
    impacted,
    total: [...totalSet].sort(),
    byPackage,
    coverage: graph.nodes.length ? totalSet.size / graph.nodes.length : 0,
  };
}

/**
 * Full impact analysis: which packages the PR touches (with file attribution +
 * graph centrality), and the blast radius. The single entry point the PR
 * analyzer calls.
 */
export function analyzeImpact(
  graph: DependencyGraph,
  packages: PackageInfo[],
  workspaceRoot: string,
  changedFiles: string[],
): { changed: ChangedPackage[]; blastRadius: BlastRadius } {
  const fileMap = attributeFiles(packages, workspaceRoot, changedFiles);
  const editedIds = [...fileMap.keys()];
  const blastRadius = computeBlastRadius(graph, editedIds);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const nameById = new Map(packages.map((p) => [p.id, p.name]));

  const changed: ChangedPackage[] = [];
  for (const id of blastRadius.edited) {
    const node = nodeById.get(id);
    changed.push({
      id,
      name: nameById.get(id) ?? id,
      reason: "edited",
      changedFiles: fileMap.get(id) ?? [],
      centrality: node?.metrics.centrality ?? 0,
      dependents: node?.metrics.transitiveDependents ?? 0,
    });
  }
  for (const id of blastRadius.impacted) {
    const node = nodeById.get(id);
    changed.push({
      id,
      name: nameById.get(id) ?? id,
      reason: "dependency",
      changedFiles: [],
      centrality: node?.metrics.centrality ?? 0,
      dependents: node?.metrics.transitiveDependents ?? 0,
    });
  }

  // Edited first, then by centrality (most central first).
  changed.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === "edited" ? -1 : 1;
    return b.centrality - a.centrality;
  });

  return { changed, blastRadius };
}
