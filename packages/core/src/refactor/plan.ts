import type {
  BoundaryRule,
  DependencyGraph,
} from "@package-workbench/plugin-sdk";
import type { ExportUsageReport } from "../intel/types";
import { detectProblems } from "./smells";
import { recompute, type WorkingGraph } from "./project";
import {
  suggestDeletions,
  suggestForProblem,
  type StrategyContext,
} from "./strategies";
import type {
  ArchitecturalProblem,
  RefactorPlan,
  RefactorSuggestion,
} from "./types";

/**
 * The Refactor Architect orchestrator. Detects problems, generates grounded
 * suggestions, and assembles ranked plans. "Generate Alternative Plans" produces
 * genuinely different strategies from the same suggestion pool — Balanced,
 * Minimal-risk, and Max-impact — rather than re-wording one plan.
 *
 * Conservative throughout: at most one suggestion per focal package, only
 * positive-impact suggestions, capped total.
 */

export interface RefactorAnalysisInput {
  graph: DependencyGraph;
  /** Optional export-usage reports — enable leaky-abstraction detection. */
  intel?: ExportUsageReport[];
  /** Boundary rules (so projected violations are recomputed correctly). */
  rules?: BoundaryRule[];
  now?: () => string;
}

const MAX_SUGGESTIONS = 8;

/** Build the full pool of candidate suggestions (deduped to one per focal package). */
function buildPool(input: RefactorAnalysisInput): {
  problems: ArchitecturalProblem[];
  pool: RefactorSuggestion[];
} {
  const { graph } = input;
  const rules = input.rules ?? [];
  const working: WorkingGraph = { nodes: graph.nodes, edges: graph.edges };
  const baseline = recompute(working, rules);
  const ctx: StrategyContext = { graph, working, baseline, rules };

  const problems = detectProblems(graph, { intel: input.intel });

  const raw: RefactorSuggestion[] = [];
  for (const p of problems) {
    const s = suggestForProblem(p, ctx);
    if (s) raw.push(s);
  }
  raw.push(...suggestDeletions(ctx));

  // One suggestion per focal package — keep the highest score (avoid over-refactoring).
  const bestByFocal = new Map<string, RefactorSuggestion>();
  for (const s of raw.sort((a, b) => b.score - a.score)) {
    const focal = s.targetPackages[0]!;
    if (!bestByFocal.has(focal)) bestByFocal.set(focal, s);
  }
  const pool = [...bestByFocal.values()].sort((a, b) => b.score - a.score);
  return { problems, pool };
}

function assemble(
  problems: ArchitecturalProblem[],
  suggestions: RefactorSuggestion[],
  variant: number,
  now: () => string,
): RefactorPlan {
  const top = suggestions[0];
  const summary = top
    ? `${problems.length} problem(s) · top fix: ${top.title} (${top.impact.healthScoreDelta >= 0 ? "+" : ""}${top.impact.healthScoreDelta} health, ${Math.round(top.impact.cycleReductionPct * 100)}% fewer cycles)`
    : `${problems.length} problem(s) · no conservative refactor improves the graph`;
  return {
    problems,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    summary,
    variant,
    generatedAt: now(),
  };
}

/** Analyze a graph and return the primary (Balanced) refactor plan. */
export function analyzeRefactor(input: RefactorAnalysisInput): RefactorPlan {
  const now = input.now ?? (() => new Date().toISOString());
  const { problems, pool } = buildPool(input);
  return assemble(problems, pool, 0, now);
}

export const PLAN_VARIANTS = [
  "Balanced",
  "Minimal-risk",
  "Max-impact",
] as const;
export type PlanVariant = (typeof PLAN_VARIANTS)[number];

/**
 * Generate alternative plans from the same pool:
 *  0 Balanced     — every positive suggestion, ranked by score.
 *  1 Minimal-risk — only low/medium-risk refactors (no large splits).
 *  2 Max-impact   — ranked by raw impact (health + cycles), risk ignored.
 */
export function generateAlternativePlans(
  input: RefactorAnalysisInput,
): RefactorPlan[] {
  const now = input.now ?? (() => new Date().toISOString());
  const { problems, pool } = buildPool(input);

  const balanced = pool;
  const minimalRisk = pool
    .filter((s) => s.risk.level !== "high")
    .sort((a, b) => b.score - a.score);
  const maxImpact = [...pool].sort(
    (a, b) =>
      b.impact.healthScoreDelta +
      b.impact.cycleReduction * 6 -
      (a.impact.healthScoreDelta + a.impact.cycleReduction * 6),
  );

  const plans = [
    assemble(problems, balanced, 0, now),
    assemble(problems, minimalRisk, 1, now),
    assemble(problems, maxImpact, 2, now),
  ];
  // Drop empty / duplicate-ordering variants so we don't show redundant plans.
  const seen = new Set<string>();
  return plans.filter((p) => {
    if (p.suggestions.length === 0) return p.variant === 0; // keep Balanced even if empty
    const sig = p.suggestions.map((s) => s.id).join("|");
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}
