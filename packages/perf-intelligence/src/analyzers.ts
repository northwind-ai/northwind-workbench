import type {
  PackageHealthReport,
  PackageIntelligenceReport,
} from "@package-workbench/core";
import type {
  DependencyCost,
  MemoryMetrics,
  RuntimePerformanceMetrics,
} from "./types";

/**
 * The small per-concern analyzers — memory, runtime latency, and dependency cost
 * — pulled from metrics the engines already captured. Pure + deterministic.
 */

const SPIKE_BYTES = 100 * 1024 * 1024; // 100 MB

/** Memory metrics from a package's scenario heap deltas. */
export function computeMemory(report: PackageHealthReport): MemoryMetrics {
  const samples = (report.scenarios?.results ?? [])
    .map((r) => r.memoryBytes ?? 0)
    .filter((b) => b > 0);
  if (samples.length === 0)
    return { peakBytes: 0, avgBytes: 0, spike: false, leakSuspicion: false };
  const peakBytes = Math.max(...samples);
  const avgBytes = Math.round(
    samples.reduce((a, b) => a + b, 0) / samples.length,
  );
  const spike =
    peakBytes >= SPIKE_BYTES || (avgBytes > 0 && peakBytes > avgBytes * 5);
  // Leak suspicion: heap delta grows monotonically across >= 3 scenarios.
  const leakSuspicion =
    samples.length >= 3 &&
    samples.every((v, i) => i === 0 || v >= samples[i - 1]!) &&
    samples[samples.length - 1]! > samples[0]! * 1.5;
  return { peakBytes, avgBytes, spike, leakSuspicion };
}

/** Runtime import/execution latency from a package's runtime report. */
export function computeRuntime(
  report: PackageHealthReport,
): RuntimePerformanceMetrics {
  const durations = (report.runtime?.targets ?? [])
    .map((t) => t.execution?.durationMs ?? 0)
    .filter((d) => d > 0);
  const importLatencyMs = durations.reduce((a, b) => a + b, 0);
  const slowestImportMs = durations.length ? Math.max(...durations) : 0;
  return { importLatencyMs, slowestImportMs };
}

/** Dependency cost: heavy/unused deps + duplicate-version weight, from intel. */
export function analyzeDependencyCosts(
  intel: PackageIntelligenceReport | undefined,
): DependencyCost[] {
  if (!intel) return [];
  const out: DependencyCost[] = [];

  for (const weight of intel.dependencyWeight) {
    for (const issue of weight.issues) {
      if (issue.kind === "heavy")
        out.push({
          dependency: issue.dependency,
          kind: "heavy",
          detail: issue.detail,
          packages: [weight.packageName],
        });
      else if (issue.kind === "unused")
        out.push({
          dependency: issue.dependency,
          kind: "unused",
          detail: issue.detail,
          packages: [weight.packageName],
        });
    }
  }
  for (const dup of intel.duplicateVersions) {
    out.push({
      dependency: dup.dependency,
      kind: "duplicate",
      detail: `${dup.versions.length} versions across ${dup.packages.length} package(s)`,
      versions: dup.versions,
      packages: dup.packages,
    });
  }

  // Merge same-dependency heavy entries; rank duplicates (most versions) + heavy first.
  const merged = mergeByDependency(out);
  return merged.sort((a, b) => rank(b) - rank(a)).slice(0, 10);
}

function rank(c: DependencyCost): number {
  if (c.kind === "duplicate")
    return 100 + (c.versions?.length ?? 0) * 10 + c.packages.length;
  if (c.kind === "heavy") return 50 + c.packages.length;
  return c.packages.length;
}

function mergeByDependency(costs: DependencyCost[]): DependencyCost[] {
  const map = new Map<string, DependencyCost>();
  for (const c of costs) {
    const key = `${c.dependency}:${c.kind}`;
    const existing = map.get(key);
    if (existing)
      existing.packages = [...new Set([...existing.packages, ...c.packages])];
    else map.set(key, { ...c, packages: [...c.packages] });
  }
  return [...map.values()];
}
