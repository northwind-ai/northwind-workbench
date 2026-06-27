/**
 * @package-workbench/inventory — Repository Inventory & Technical Debt Auditor.
 *
 * A comprehensive inventory (what packages exist, their class, activity status,
 * size, dependents, coverage, health) plus a conservative technical-debt audit
 * (TODO/FIXME/HACK markers, incomplete features, mock leakage, dead exports/
 * packages, duplicate utilities) with per-package debt scoring.
 *
 * Reuses the dependency graph, package intelligence, and health engines; the
 * source scanning + classification + scoring are pure and deterministic, and
 * dead-code classification is deliberately conservative to avoid false positives.
 */
export * from "./types";
export { classifyPackage } from "./classify";
export {
  scanDebt,
  determineActivity,
  estimateCoverage,
  scoreDebt,
  type SourceLike,
  type ActivityInput,
  type DebtScoreInput,
} from "./debt";
export {
  analyzeInventory,
  type AnalyzeInventoryOptions,
  type InventoryResult,
} from "./analyze";
export {
  renderInventoryText,
  renderInventoryMarkdown,
  renderInventoryHtml,
} from "./render";
