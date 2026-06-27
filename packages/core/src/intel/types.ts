/**
 * Package-intelligence model: export inventory + usage, bundle size, and
 * dependency weight. Pure types only.
 *
 * The guiding principle is *conservative certainty*. Telling a developer an
 * export is "safe to delete" when it's part of a published package's public API
 * is dangerous, so every verdict is hedged by what we can actually prove: an
 * export is only "definitely dead" when its package is private AND nothing in the
 * workspace imports it. Anything public is, at most, "unused internally — public
 * API unknown".
 */

// ---- Export inventory --------------------------------------------------------

export type ExportKind =
  | "named" // export const/function/class X, export { X }
  | "default" // export default …
  | "re-export" // export { X } from './y'
  | "star-re-export" // export * from './y'
  | "type"; // export type / interface, export { type X }

/** A single exported symbol from a package. */
export interface ExportSymbol {
  /** Exported name (`default` for a default export). */
  name: string;
  kind: ExportKind;
  /** True for type-only exports (erased at runtime). */
  typeOnly: boolean;
  /** Source file (workspace-relative) the export was found in. */
  file: string;
  /** For re-exports: the module specifier it forwards from. */
  from?: string;
}

/** Every export a package exposes, plus its declared entry surface. */
export interface ExportInventory {
  packageId: string;
  packageName: string;
  /** Whether the package is private (drives deletion-safety). */
  private: boolean;
  symbols: ExportSymbol[];
  /** Subpaths declared in the package.json "exports" map. */
  exportsMapEntries: string[];
  /** True when the package re-exports through `export *` (usage is harder to prove). */
  hasStarReExport: boolean;
}

// ---- Usage analysis ----------------------------------------------------------

/**
 * Conservative usage classification, weakest-claim-first:
 *  - `used`                — imported somewhere in the workspace.
 *  - `unused-internally`   — no internal importer (a *public* package may still
 *                            be used by external consumers — never delete on this alone).
 *  - `public-api-unknown`  — package is public; external usage is unknowable here.
 *  - `likely-dead`         — private package, unused internally, but reached via a
 *                            star re-export / ambiguous chain (some doubt remains).
 *  - `definitely-dead`     — private package, no internal usage, unambiguous. Only
 *                            here do we suggest deletion.
 */
export type UsageClass =
  | "used"
  | "unused-internally"
  | "public-api-unknown"
  | "likely-dead"
  | "definitely-dead";

export interface ExportUsage {
  symbol: ExportSymbol;
  usageClass: UsageClass;
  /** Internal packages that import this symbol. */
  consumers: string[];
  /** Number of internal import sites. */
  internalUses: number;
  /** 0..1 — confidence in the classification (deletion advice scales with this). */
  confidence: number;
  /** Human note explaining the verdict. */
  note: string;
}

export interface ExportUsageReport {
  packageId: string;
  packageName: string;
  private: boolean;
  exports: ExportUsage[];
  /** Counts by class, for quick summaries. */
  summary: Record<UsageClass, number>;
  /** Re-export chains that forward symbols nothing imports. */
  staleReExports: Array<{ file: string; from: string; note: string }>;
}

// ---- Bundle size -------------------------------------------------------------

export interface FileSize {
  /** Package-relative path. */
  file: string;
  bytes: number;
  /** gzipped size, when computed. */
  gzipBytes?: number;
}

export interface SizeReport {
  packageId: string;
  packageName: string;
  /** True when a build output directory was found + measured. */
  measured: boolean;
  /** Directory measured (e.g. dist), package-relative. */
  outputDir?: string;
  totalBytes: number;
  gzipBytes?: number;
  fileCount: number;
  /** Largest files, descending. */
  largestFiles: FileSize[];
  /** Dependencies likely to inflate a browser bundle (heuristic). */
  heavyClientDeps: string[];
  /** Size change vs a historical baseline, when available. */
  delta?: { previousBytes: number; deltaBytes: number };
  note?: string;
}

// ---- Dependency weight -------------------------------------------------------

export type DependencyIssueKind =
  | "unused" // declared but never imported
  | "test-only-runtime" // declared as a runtime dep but only imported from tests
  | "duplicate-version" // multiple versions of the same dep across the workspace
  | "heavy"; // a known-large dependency

export interface DependencyIssue {
  kind: DependencyIssueKind;
  dependency: string;
  detail: string;
  /** 0..1 confidence. */
  confidence: number;
  /** For duplicate-version: the distinct ranges seen. */
  versions?: string[];
}

export interface DependencyWeightReport {
  packageId: string;
  packageName: string;
  declaredCount: number;
  issues: DependencyIssue[];
}

// ---- Workspace roll-up -------------------------------------------------------

/** The complete package-intelligence analysis for a workspace. */
export interface PackageIntelligenceReport {
  inventories: ExportInventory[];
  usage: ExportUsageReport[];
  sizes: SizeReport[];
  dependencyWeight: DependencyWeightReport[];
  /** Dependencies appearing at multiple versions across the workspace. */
  duplicateVersions: Array<{
    dependency: string;
    versions: string[];
    packages: string[];
  }>;
  generatedAt: string;
}

// ---- Config / thresholds -----------------------------------------------------

export interface ApiIntelConfig {
  /** Flag exports that are unused internally (default true). */
  flagUnusedExports?: boolean;
}

export interface SizeIntelConfig {
  /** Warn when a package's measured dist exceeds this many KB. */
  maxPackageDistKb?: number;
  /** Warn when any single file exceeds this many KB. */
  maxSingleFileKb?: number;
  /** Compute gzip sizes (slower). Default true. */
  gzip?: boolean;
}

export interface IntelConfig {
  api?: ApiIntelConfig;
  size?: SizeIntelConfig;
}

export const DEFAULT_INTEL_CONFIG: Required<ApiIntelConfig> & {
  size: Required<SizeIntelConfig>;
} & { api: Required<ApiIntelConfig> } = {
  flagUnusedExports: true,
  api: { flagUnusedExports: true },
  size: { maxPackageDistKb: 500, maxSingleFileKb: 200, gzip: true },
};
