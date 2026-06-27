/**
 * @package-workbench/perf-intelligence — analyze repository performance
 * bottlenecks (build, runtime, memory, dependencies, CI) and detect regressions.
 *
 * Reuses metrics the engines already capture (check durations, scenario timings +
 * heap deltas, runtime import latency, bundle sizes, dependency weight); adds an
 * optional live build profiler, snapshot persistence, regression comparison, and
 * bottleneck ranking. Deterministic where its inputs are.
 */
export * from "./types";
export {
  collectSnapshot,
  type BuildSample,
  type CollectOptions,
} from "./collect";
export {
  computeMemory,
  computeRuntime,
  analyzeDependencyCosts,
} from "./analyzers";
export { compareSnapshots } from "./regression";
export { rankBottlenecks } from "./rank";
export { createPerfStore, defaultPerfDir, type PerfStore } from "./store";
export {
  deriveBuildCommand,
  profileBuilds,
  type BuildCommandContext,
  type ProfileOptions,
} from "./profile";
export { analyzePerformance, type AnalyzePerfOptions } from "./analyze";
export { renderPerfText, renderPerfMarkdown } from "./render";
