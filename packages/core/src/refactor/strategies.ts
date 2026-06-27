import type {
  BoundaryRule,
  DependencyGraph,
} from "@package-workbench/plugin-sdk";
import { estimateImpact } from "./impact";
import {
  projectDelete,
  projectExtractTypes,
  projectMerge,
  projectRemoveEdge,
  projectSplit,
  recompute,
  type Recomputed,
  type WorkingGraph,
} from "./project";
import type {
  ArchitecturalProblem,
  RefactorRisk,
  RefactorRiskLevel,
  RefactorStrategy,
  RefactorSuggestion,
} from "./types";

/**
 * The strategy engine. Maps each detected problem to a concrete refactor, builds
 * the projected graph, and lets {@link estimateImpact} ground the numbers.
 * Conservative: a suggestion is only emitted if its *recomputed* impact is
 * genuinely positive (health up, cycles down, or real dependency reduction).
 */

export interface StrategyContext {
  graph: DependencyGraph;
  working: WorkingGraph;
  baseline: Recomputed;
  rules: BoundaryRule[];
}

const RISK_FACTOR: Record<RefactorRiskLevel, number> = {
  low: 1,
  medium: 1.6,
  high: 2.6,
};

/** Split a package name into layer-suffixed children (scope-aware). */
export function deriveSplitNames(name: string): {
  types: string;
  runtime: string;
  services: string;
} {
  return {
    types: `${name}-types`,
    runtime: `${name}-runtime`,
    services: `${name}-services`,
  };
}

function risk(
  level: RefactorRiskLevel,
  effort: RefactorRisk["effort"],
  affected: number,
  factors: string[],
): RefactorRisk {
  return { level, effort, affectedPackages: affected, factors };
}

/** Build a suggestion from a problem, or null if its impact isn't worth it. */
export function suggestForProblem(
  problem: ArchitecturalProblem,
  ctx: StrategyContext,
  idSuffix = "",
): RefactorSuggestion | null {
  const built = buildSuggestion(problem, ctx, idSuffix);
  if (!built) return null;
  // Conservative gate: must demonstrably help.
  const { impact } = built;
  const helps =
    impact.healthScoreDelta > 0 ||
    impact.cycleReduction > 0 ||
    impact.dependencyReduction > 0;
  if (!helps) return null;
  return built;
}

function finalize(
  problem: ArchitecturalProblem,
  ctx: StrategyContext,
  opts: {
    id: string;
    strategy: RefactorStrategy;
    title: string;
    targetPackages: string[];
    newPackages: string[];
    steps: string[];
    focal: string;
    projection: ReturnType<typeof projectSplit>;
    risk: RefactorRisk;
    tradeoffs: string[];
  },
): RefactorSuggestion {
  const { impact, visualization } = estimateImpact(
    ctx.working,
    ctx.baseline,
    opts.projection,
    opts.focal,
    ctx.rules,
  );

  const value =
    impact.healthScoreDelta * 1 +
    impact.cycleReduction * 5 +
    impact.fanOutReduction * 1 +
    Math.max(0, impact.dependencyReduction) * 0.5;
  const score = Math.round((value / RISK_FACTOR[opts.risk.level]) * 10) / 10;

  return {
    id: opts.id,
    strategy: opts.strategy,
    title: opts.title,
    targetPackages: opts.targetPackages,
    newPackages: opts.newPackages,
    steps: opts.steps,
    problem,
    impact,
    risk: opts.risk,
    explanation: {
      why: problem.detail,
      howItHelps: impact.rationale[0]!,
      tradeoffs: opts.tradeoffs,
      evidence: [...problem.evidence, ...impact.rationale.slice(1, 3)],
    },
    visualization,
    score,
  };
}

function buildSuggestion(
  problem: ArchitecturalProblem,
  ctx: StrategyContext,
  idSuffix: string,
): RefactorSuggestion | null {
  const id = `${problem.kind}:${problem.packageId ?? problem.packages?.[0] ?? "x"}${idSuffix}`;

  switch (problem.kind) {
    case "god_package":
    case "overcoupled":
    case "utility_blob":
    case "leaky_abstraction": {
      const pkg = problem.packageId!;
      const node = ctx.graph.nodes.find((n) => n.id === pkg);
      const name = node?.name ?? pkg;
      const parts = deriveSplitNames(name);
      const isRuntimeMix =
        node?.runtime === "universal" || node?.runtime === "electron";
      const strategy: RefactorStrategy =
        problem.kind === "leaky_abstraction"
          ? "extract_shared_types"
          : isRuntimeMix
            ? "isolate_runtime_layer"
            : "split_package";
      const projection = projectSplit(ctx.working, pkg, parts);
      return finalize(problem, ctx, {
        id,
        strategy,
        title: `Split ${name} into ${parts.types}, ${parts.runtime}, ${parts.services}`,
        targetPackages: [pkg],
        newPackages: [parts.types, parts.runtime, parts.services],
        steps: [
          `Create ${parts.types} for the public types/contracts (no runtime dependencies).`,
          `Move runtime implementation into ${parts.runtime}, depending on ${parts.types}.`,
          `Move orchestration/services into ${parts.services}, depending on ${parts.runtime}.`,
          `Update consumers to import types from ${parts.types}.`,
        ],
        focal: pkg,
        projection,
        risk: risk(
          "high",
          "large",
          (node?.metrics.fanIn ?? 0) + (node?.metrics.fanOut ?? 0),
          [
            "Touches every consumer of the package",
            "Requires moving code across new package boundaries",
          ],
        ),
        tradeoffs: [
          "Adds package overhead (3 packages instead of 1)",
          "Short-term churn for consumers updating imports",
        ],
      });
    }

    case "dependency_cycle": {
      const cyclePath = problem.packages ?? [];
      if (cyclePath.length < 2) return null;
      const from = cyclePath[cyclePath.length - 1]!;
      const to = cyclePath[0]!;
      const typesId = `${to}-types`;
      const projection = projectExtractTypes(
        ctx.working,
        { from, to },
        typesId,
      );
      return finalize(problem, ctx, {
        id,
        strategy: "extract_shared_types",
        title: `Break cycle by extracting ${typesId}`,
        targetPackages: cyclePath,
        newPackages: [typesId],
        steps: [
          `Extract the shared types that ${from} and ${to} both need into ${typesId}.`,
          `Point both ${from} and ${to} at ${typesId} instead of at each other.`,
          `Remove the ${from} → ${to} back-edge.`,
        ],
        focal: from,
        projection,
        risk: risk("medium", "medium", cyclePath.length, [
          "Requires identifying the exact shared types",
          "Consumers of the moved types update imports",
        ]),
        tradeoffs: [
          "Introduces one small types package",
          "Type ownership moves out of the original package",
        ],
      });
    }

    case "layer_violation": {
      const [from, to] = problem.packages ?? [];
      if (!from || !to) return null;
      const projection = projectRemoveEdge(ctx.working, from, to);
      return finalize(problem, ctx, {
        id,
        strategy: "move_dependency",
        title: `Re-route ${from} → ${to} through an allowed boundary`,
        targetPackages: [from, to],
        newPackages: [],
        steps: [
          `Identify what ${from} needs from ${to}.`,
          `Move that capability to an allowed lower-level package, or invert the dependency.`,
          `Remove the forbidden ${from} → ${to} edge.`,
        ],
        focal: from,
        projection,
        risk: risk("medium", "medium", 2, [
          "The needed capability must live somewhere allowed",
          "May require a small extraction",
        ]),
        tradeoffs: ["Possible indirection through a new boundary"],
      });
    }

    case "feature_fragmentation": {
      const members = problem.packages ?? [];
      if (members.length < 2) return null;
      const mergedNode = ctx.graph.nodes.find((n) => n.id === members[0]);
      const prefix = (mergedNode?.name ?? members[0]!).replace(
        /[-_][^-_/]+$/,
        "",
      );
      const mergedId = `${prefix}`;
      const projection = projectMerge(ctx.working, members, mergedId);
      return finalize(problem, ctx, {
        id,
        strategy: "merge_packages",
        title: `Consolidate ${members.length} fragmented packages into ${mergedId}`,
        targetPackages: members,
        newPackages: [mergedId],
        steps: [
          `Merge ${members.join(", ")} into a single ${mergedId} package with internal modules.`,
          `Preserve public entry points via the package's exports map.`,
          `Update consumers to import from ${mergedId}.`,
        ],
        focal: members[0]!,
        projection,
        risk: risk("low", "medium", members.length, [
          "Public API of each merged package must be preserved",
        ]),
        tradeoffs: [
          "One larger package instead of several tiny ones",
          "Loses independent versioning of the merged pieces",
        ],
      });
    }

    default:
      return null;
  }
}

/** Suggestions for dead/orphan packages (delete strategy), from graph smells. */
export function suggestDeletions(ctx: StrategyContext): RefactorSuggestion[] {
  const out: RefactorSuggestion[] = [];
  for (const smell of ctx.graph.smells) {
    if (smell.kind !== "dead_package" && smell.kind !== "orphan") continue;
    const node = ctx.graph.nodes.find((n) => n.id === smell.packageId);
    if (!node) continue;
    const problem: ArchitecturalProblem = {
      kind: "overcoupled", // not used for scoring here; placeholder family
      packageId: node.id,
      severity: "low",
      metrics: { fanIn: node.metrics.fanIn, fanOut: node.metrics.fanOut },
      evidence: [smell.detail],
      detail: `${node.name} is ${smell.kind === "orphan" ? "isolated (no dependents or dependencies)" : "unused (no dependents)"}.`,
    };
    const projection = projectDelete(ctx.working, node.id);
    const built = finalize(problem, ctx, {
      id: `delete:${node.id}`,
      strategy: "delete_dead_package",
      title: `Delete dead package ${node.name}`,
      targetPackages: [node.id],
      newPackages: [],
      steps: [
        `Confirm ${node.name} has no external consumers (it has no internal ones).`,
        `Remove the package and its workspace entry.`,
      ],
      focal: node.id,
      projection,
      risk: risk("low", "small", 1, [
        "Confirm there are no external/runtime consumers before deleting",
      ]),
      tradeoffs: [
        "Irreversible without version control — confirm it is truly unused",
      ],
    });
    if (built.impact.healthScoreDelta >= 0) out.push(built);
  }
  return out;
}

export { recompute };
