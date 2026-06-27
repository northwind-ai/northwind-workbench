/**
 * The runtime validation engine: detection, static browser/export analysis, and
 * sandboxed import execution, composed by {@link buildRuntimeReport}.
 */
export { buildRuntimeReport, type BuildRuntimeReportOptions } from "./matrix";
export { detectRuntime, manifestSignals, builtinSignals } from "./detect";
export {
  analyzeBrowserCompat,
  type BrowserCompatReport,
  type BuiltinUsage,
} from "./browser-compat";
export {
  validateExports,
  type ExportsValidation,
  type ExportsIssue,
  type ExportsIssueSeverity,
} from "./exports";
export {
  executeImport,
  classifyImportError,
  type ExecuteImportOptions,
} from "./sandbox";
export {
  scanPackageImports,
  extractSpecifiers,
  type ImportRef,
} from "./source-scan";
export {
  resolvePrimaryEntry,
  resolveTarget,
  pathExists,
  classifyFormat,
  exportsDotConditions,
} from "./resolve";
export {
  NODE_BUILTINS,
  HARD_BROWSER_BREAKERS,
  POLYFILLABLE_BUILTINS,
  builtinName,
  browserImpact,
} from "./builtins";
