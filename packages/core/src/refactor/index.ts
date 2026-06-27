/**
 * AI Refactor Architect — proposes architecture improvements (split, merge,
 * extract types, move dependency, introduce boundary, delete dead package).
 *
 * Every impact number is *grounded*: the engine projects an "after" graph and
 * re-runs the real graph engine on it, then diffs. It is conservative (only
 * suggests refactors whose recomputed impact is positive, one per package,
 * never auto-applies) and explainable (every suggestion cites graph evidence and
 * ships a before/after).
 */
export * from "./types";
export { detectProblems, type SmellOptions } from "./smells";
export {
  analyzeRefactor,
  generateAlternativePlans,
  PLAN_VARIANTS,
  type RefactorAnalysisInput,
  type PlanVariant,
} from "./plan";
export { renderRefactorText, renderRefactorMarkdown } from "./render";
export { deriveSplitNames } from "./strategies";
export {
  recompute,
  projectSplit,
  projectMerge,
  projectExtractTypes,
  projectRemoveEdge,
  projectDelete,
  type WorkingGraph,
  type Projection,
  type Recomputed,
} from "./project";
