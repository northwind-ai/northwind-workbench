/**
 * @package-workbench/git-intelligence — analyze only what changed.
 *
 * Discovers changed files (working tree / staged / branch / commit ranges),
 * maps them to packages, computes the dependency blast radius (reusing the PR
 * engine), scores change risk, predicts likely regressions, and emits a targeted
 * scan plan — turning a whole-repo scan into a change-sized one.
 *
 * Deterministic + cross-platform; the git layer degrades gracefully outside a
 * repository.
 */
export * from "./types";
export {
  parseNameStatus,
  parseUntracked,
  diffArgs,
  getChangedFiles,
} from "./git";
export { scoreDiffRisk, classifyFile, type RiskInput } from "./risk";
export { predictRegressions, planScans, scanSavings } from "./predict";
export { analyzeDiff, type AnalyzeDiffOptions } from "./analyze";
export { renderDiffText, renderDiffMarkdown } from "./render";
