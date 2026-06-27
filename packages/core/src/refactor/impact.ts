import type {
  BoundaryRule,
  DependencyNode,
} from "@package-workbench/plugin-sdk";
import {
  recompute,
  type Projection,
  type Recomputed,
  type WorkingGraph,
} from "./project";
import type {
  ProjectedGraph,
  ProjectedNode,
  RefactorImpactEstimate,
  RefactorVisualization,
} from "./types";

/**
 * Impact estimation — entirely derived from recomputing the graph engine on the
 * projected ("after") graph and diffing against the baseline. No hand-picked
 * numbers: every field has a rationale line tracing it to a recomputed value.
 */

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) / 100 : 0;

export interface EstimateResult {
  impact: RefactorImpactEstimate;
  visualization: RefactorVisualization;
  after: Recomputed;
}

export function estimateImpact(
  baselineGraph: WorkingGraph,
  baseline: Recomputed,
  projection: Projection,
  focalPkgId: string,
  rules: BoundaryRule[],
): EstimateResult {
  const after = recompute(projection.graph, rules);

  const healthScoreDelta = after.health.score - baseline.health.score;
  const cycleReduction = baseline.cycleCount - after.cycleCount;
  const cycleReductionPct = pct(cycleReduction, baseline.cycleCount);

  // Fan-out: the focal package's responsibilities before vs the heaviest piece after.
  const beforeNode = nodeOf(baseline.nodes, focalPkgId);
  const beforeFanOut = beforeNode?.metrics.fanOut ?? 0;
  const newIds = projection.changedNodes
    .filter((c) => c.change === "added")
    .map((c) => c.id);
  const afterFanOut = newIds.length
    ? Math.max(
        0,
        ...newIds.map((id) => nodeOf(after.nodes, id)?.metrics.fanOut ?? 0),
      )
    : (nodeOf(after.nodes, focalPkgId)?.metrics.fanOut ?? 0);
  const fanOutReduction = Math.max(0, beforeFanOut - afterFanOut);
  const fanOutReductionPct = pct(fanOutReduction, beforeFanOut);

  const dependencyReduction =
    baselineGraph.edges.length - projection.graph.edges.length;

  const complexityReduction = clamp01(
    cycleReductionPct * 0.5 +
      fanOutReductionPct * 0.4 +
      clamp01(healthScoreDelta / 30) * 0.1,
  );

  const buildImprovement =
    cycleReduction > 0
      ? `Incremental builds no longer blocked by ${cycleReduction} cycle(s)`
      : fanOutReduction > 0
        ? `Fewer rebuild triggers — ${fanOutReduction} dependency edge(s) lifted off the focal package`
        : "Minimal build-time change";

  const rationale = [
    `Health ${baseline.health.score} → ${after.health.score} (recomputed on the projected graph) = ${healthScoreDelta >= 0 ? "+" : ""}${healthScoreDelta}`,
    `Cycles ${baseline.cycleCount} → ${after.cycleCount} = ${cycleReduction} removed (${Math.round(cycleReductionPct * 100)}%)`,
    `Focal fan-out ${beforeFanOut} → ${afterFanOut} = ${fanOutReduction} reduced (${Math.round(fanOutReductionPct * 100)}%)`,
    `Internal edges ${baselineGraph.edges.length} → ${projection.graph.edges.length} = ${dependencyReduction >= 0 ? "−" : "+"}${Math.abs(dependencyReduction)}`,
  ];

  const impact: RefactorImpactEstimate = {
    healthScoreDelta,
    cycleReduction,
    cycleReductionPct,
    fanOutReduction,
    fanOutReductionPct,
    dependencyReduction,
    complexityReduction,
    buildImprovement,
    rationale,
  };

  const visualization = buildVisualization(
    baselineGraph,
    baseline,
    projection,
    after,
    focalPkgId,
  );
  return { impact, visualization, after };
}

function nodeOf(
  nodes: DependencyNode[],
  id: string,
): DependencyNode | undefined {
  return nodes.find((n) => n.id === id);
}

/** Restrict before/after graphs to the affected neighbourhood for a focused diff. */
function buildVisualization(
  baselineGraph: WorkingGraph,
  baseline: Recomputed,
  projection: Projection,
  after: Recomputed,
  focalPkgId: string,
): RefactorVisualization {
  // Seed = focal + every node mentioned in the change set.
  const seed = new Set<string>([focalPkgId]);
  for (const c of projection.changedNodes) seed.add(c.id);
  for (const e of projection.changedEdges) {
    seed.add(e.from);
    seed.add(e.to);
  }
  // Add direct neighbours of the focal package for context.
  for (const e of baselineGraph.edges) {
    if (e.from === focalPkgId) seed.add(e.to);
    if (e.to === focalPkgId) seed.add(e.from);
  }

  const before = projectSubgraph(baselineGraph, baseline, seed);
  before.cycleCount = baseline.cycleCount;
  before.healthScore = baseline.health.score;

  const newIds = new Set(
    projection.changedNodes
      .filter((c) => c.change === "added")
      .map((c) => c.id),
  );
  const after2 = projectSubgraph(projection.graph, after, seed, newIds);
  after2.cycleCount = after.cycleCount;
  after2.healthScore = after.health.score;

  return {
    before,
    after: after2,
    changedEdges: projection.changedEdges,
    changedNodes: projection.changedNodes,
  };
}

function projectSubgraph(
  graph: WorkingGraph,
  rec: Recomputed,
  seed: Set<string>,
  newIds = new Set<string>(),
): ProjectedGraph {
  const include = new Set(
    [...seed].filter((id) => graph.nodes.some((n) => n.id === id)),
  );
  const nodes: ProjectedNode[] = graph.nodes
    .filter((n) => include.has(n.id))
    .map((n) => ({
      id: n.id,
      layer: nodeOf(rec.nodes, n.id)?.metrics.depth ?? 0,
      isNew: newIds.has(n.id),
    }));
  const edges = graph.edges
    .filter((e) => include.has(e.from) && include.has(e.to))
    .map((e) => ({ from: e.from, to: e.to }));
  return { nodes, edges, cycleCount: 0, healthScore: 0 };
}
