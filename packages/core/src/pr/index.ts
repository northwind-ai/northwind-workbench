/**
 * Pull-request analysis — catch package regressions before merge. Compares a PR
 * (head) run against its base snapshot, computes a dependency-aware blast radius,
 * scores risk, applies a merge policy, and renders a PR comment + status check.
 *
 * Builds on the existing delta engine ({@link compareRuns}) rather than
 * re-deriving regressions. Deterministic and scan-free (it consumes runs the
 * engine already produced), so it is fast enough to run on every PR in CI.
 */
export * from "./types";
export {
  attributeFiles,
  transitiveDependents,
  computeBlastRadius,
  analyzeImpact,
} from "./blast-radius";
export { assessRisk, type RiskInput } from "./risk";
export {
  decideMerge,
  loadMergePolicy,
  type MergeDecisionInput,
} from "./policy";
export { analyzePullRequest, type AnalyzePrOptions } from "./analyze";
export {
  renderPrReview,
  renderPrMarkdown,
  scoreLine,
  type PrReportFormat,
} from "./report";
export {
  githubAnnotations,
  githubJobSummary,
  githubStatus,
  githubCheckConclusion,
  type CheckConclusion,
} from "./github";
