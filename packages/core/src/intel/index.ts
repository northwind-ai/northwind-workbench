/**
 * Package intelligence — export inventory + usage, bundle size, and dependency
 * weight. Answers "which exports are unused?", "which packages are getting too
 * large?", and "which dependencies inflate things?".
 *
 * Conservative by design: an export is only ever called "definitely dead" when
 * its package is private AND nothing in the workspace imports it; anything public
 * is, at most, "unused internally — public API unknown". Source scanning is
 * regex-based (dependency-free, fast for monorepos); the whole workspace is one
 * O(n) pass.
 */
export * from "./types";
export { buildExportInventory, exportsMapEntries } from "./inventory";
export { buildImportIndex, analyzeUsage, type ImportIndex } from "./usage";
export { analyzeSize, type SizeOptions } from "./size";
export {
  analyzeDependencyWeight,
  findDuplicateVersions,
  bareModuleName,
  type DepUsage,
} from "./deps";
export { analyzePackageIntelligence, type IntelOptions } from "./analyze";
export {
  loadIntelConfig,
  resolveIntelConfig,
  type ResolvedIntelConfig,
} from "./config";
export {
  intelligenceChecks,
  unusedExportCheck,
  staleReexportCheck,
  bundleSizeCheck,
  dependencyWeightCheck,
  duplicateVersionCheck,
} from "./checks";
export {
  renderApiMarkdown,
  renderSizeMarkdown,
  usageSummaryLine,
  sizeHeadline,
} from "./render";
export { readSourceFiles, extractExports, extractImports } from "./source";
