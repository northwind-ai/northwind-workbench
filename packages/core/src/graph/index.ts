import type {
  BoundaryRule,
  DependencyGraph,
  GraphStats,
  PackageInfo,
} from "@package-workbench/plugin-sdk";
import { buildDependencyGraph } from "./build";
import { computeMetrics } from "./metrics";
import { detectCycles } from "./cycles";
import { evaluateBoundaries, layeringInversions } from "./boundaries";
import { detectSmells } from "./smells";
import { computeGraphHealth } from "./score";

/**
 * The dependency-intelligence orchestrator. Builds the graph, computes metrics,
 * detects cycles + boundary violations + smells, and scores overall health.
 * Pure once the packages are scanned; never throws on a malformed repo.
 */

export interface AnalyzeGraphOptions {
  workspaceRoot: string;
  rules?: BoundaryRule[];
  now?: () => string;
}

export async function analyzeDependencyGraph(
  packages: PackageInfo[],
  opts: AnalyzeGraphOptions,
): Promise<DependencyGraph> {
  const now = opts.now ?? (() => new Date().toISOString());
  const built = await buildDependencyGraph(packages, opts.workspaceRoot);

  computeMetrics(built.nodes, built.edges);
  const cycles = detectCycles(built.nodes, built.edges);
  const violations = evaluateBoundaries(
    built.nodes,
    built.edges,
    opts.rules ?? [],
  );
  const smells = detectSmells(built.nodes);
  const inversions = layeringInversions(built.nodes, built.edges);
  const orphanCount = built.nodes.filter((n) => n.isOrphan).length;

  const health = computeGraphHealth({
    cycles,
    violations,
    smells,
    inversions,
    orphanCount,
  });

  const stats: GraphStats = {
    packageCount: built.nodes.length,
    edgeCount: built.edges.length,
    externalDependencyCount: built.externalDependencyCount,
    maxDepth: built.nodes.reduce((m, n) => Math.max(m, n.metrics.depth), 0),
    isAcyclic: cycles.length === 0,
    orphanCount,
  };

  return {
    nodes: built.nodes,
    edges: built.edges,
    cycles,
    violations,
    smells,
    health,
    stats,
    generatedAt: now(),
  };
}

export { buildDependencyGraph, type BuiltGraph } from "./build";
export { computeMetrics, buildAdjacency, type Adjacency } from "./metrics";
export { detectCycles, stronglyConnectedComponents } from "./cycles";
export { evaluateBoundaries, layeringInversions } from "./boundaries";
export { detectSmells } from "./smells";
export { computeGraphHealth, type GraphHealthInput } from "./score";
export { loadBoundaryRules } from "./rules-config";
export {
  InternalIndex,
  loadTsconfigAliases,
  bareName,
  type ResolvedSpecifier,
} from "./imports";
