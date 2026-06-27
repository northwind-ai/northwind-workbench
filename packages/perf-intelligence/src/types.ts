/**
 * Performance Intelligence — find repository performance bottlenecks (build,
 * runtime, memory, dependencies, CI) and detect regressions over time. Pure
 * types only.
 *
 * It reuses metrics the engines already capture — check durations, scenario
 * timings + heap deltas, runtime import latency, bundle sizes, dependency weight
 * — and adds optional live build profiling, regression comparison, and bottleneck
 * ranking on top. Deterministic where the inputs are deterministic.
 */

export interface BuildPerformanceMetrics {
  /** Measured build duration, when profiled. */
  durationMs?: number;
  /** Estimated relative build cost when not profiled (size + deps + checks). */
  estimatedWeight: number;
  /** Fraction of the workspace's total build cost, 0..1. */
  contribution: number;
  /** True when a cache hit was detected during profiling. */
  cacheHit?: boolean;
  failed?: boolean;
  /** True when `durationMs` is a real measurement (vs an estimate). */
  measured: boolean;
}

export interface RuntimePerformanceMetrics {
  /** Total import/execution latency across runtime targets, in ms. */
  importLatencyMs: number;
  /** Slowest single import, in ms. */
  slowestImportMs: number;
}

export interface MemoryMetrics {
  /** Peak heap delta observed (scenarios), in bytes. */
  peakBytes: number;
  /** Average heap delta across scenarios, in bytes. */
  avgBytes: number;
  /** True when a scenario showed an abnormally large spike. */
  spike: boolean;
  /** True when memory appears to grow across scenarios (leak suspicion). */
  leakSuspicion: boolean;
}

export interface PackagePerformanceReport {
  id: string;
  name: string;
  build: BuildPerformanceMetrics;
  runtime: RuntimePerformanceMetrics;
  memory: MemoryMetrics;
  /** Built bundle size, bytes (0 when not measured). */
  bundleBytes: number;
  gzipBytes?: number;
  /** Total health-check time for this package, ms. */
  checkMs: number;
  /** Total scenario time for this package, ms. */
  scenarioMs: number;
}

export interface CheckCost {
  checkId: string;
  totalMs: number;
  count: number;
  avgMs: number;
}

export type DependencyCostKind = "heavy" | "duplicate" | "unused";

export interface DependencyCost {
  dependency: string;
  kind: DependencyCostKind;
  detail: string;
  /** Estimated weight in KB, when known. */
  weightKb?: number;
  /** For duplicates: the distinct versions. */
  versions?: string[];
  /** Packages affected. */
  packages: string[];
}

/** A full performance snapshot — persistable, comparable across runs. */
export interface PerformanceSnapshot {
  id: string;
  timestamp: string;
  workspacePath: string;
  packages: PackagePerformanceReport[];
  checkCosts: CheckCost[];
  dependencyCosts: DependencyCost[];
  totals: {
    buildMs?: number;
    estimatedBuildWeight: number;
    checkMs: number;
    scenarioMs: number;
    runtimeImportMs: number;
    peakMemoryBytes: number;
    bundleBytes: number;
  };
}

export type PerfRegressionKind =
  | "build"
  | "bundle"
  | "memory"
  | "scenario"
  | "check";

export interface PerformanceRegression {
  kind: PerfRegressionKind;
  packageId?: string;
  detail: string;
  before: number;
  after: number;
  /** Percentage change (e.g. +48 means 48% slower/larger). */
  pctChange: number;
  severity: "minor" | "major" | "critical";
}

export type BottleneckCategory =
  | "build"
  | "runtime"
  | "memory"
  | "dependency"
  | "ci";

export interface Bottleneck {
  category: BottleneckCategory;
  /** The package or dependency or check responsible. */
  subject: string;
  metric: string;
  /** Display value, e.g. "41.2s" or "38% of total". */
  value: string;
  detail: string;
}

/** The complete performance analysis. */
export interface PerformanceReport {
  snapshot: PerformanceSnapshot;
  bottlenecks: Bottleneck[];
  regressions: PerformanceRegression[];
  generatedAt: string;
}
