import type {
  PackageIntelligenceReport,
  WorkbenchRun,
} from "@package-workbench/core";
import {
  analyzeDependencyCosts,
  computeMemory,
  computeRuntime,
} from "./analyzers";
import type {
  BuildPerformanceMetrics,
  CheckCost,
  PackagePerformanceReport,
  PerformanceSnapshot,
} from "./types";

/**
 * Collect a {@link PerformanceSnapshot} from a Workbench run + intelligence,
 * reusing already-captured timings (check durations, scenario times, runtime
 * import latency, bundle sizes). When live build samples are supplied the build
 * metric is *measured*; otherwise it's a deterministic estimate from size +
 * dependency count + check time, so a "build hotspot" ranking exists even
 * without running builds.
 */

export interface BuildSample {
  packageId: string;
  durationMs: number;
  cacheHit?: boolean;
  failed?: boolean;
}

export interface CollectOptions {
  run: WorkbenchRun;
  intel?: PackageIntelligenceReport;
  workspacePath: string;
  buildSamples?: BuildSample[];
  now?: () => string;
}

const KB = 1024;

export function collectSnapshot(opts: CollectOptions): PerformanceSnapshot {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const sizeById = new Map(
    (opts.intel?.sizes ?? []).map((s) => [s.packageId, s]),
  );
  const sampleById = new Map(
    (opts.buildSamples ?? []).map((s) => [s.packageId, s]),
  );

  // First pass: per-package metrics + the raw build weight/duration.
  interface Raw {
    report: PackagePerformanceReport;
    weight: number;
  }
  const raws: Raw[] = opts.run.reports.map((report) => {
    const checkMs = report.checks.reduce(
      (sum, c) => sum + (c.durationMs ?? 0),
      0,
    );
    const scenarioMs =
      report.scenarios?.durationMs ??
      (report.scenarios?.results ?? []).reduce((s, r) => s + r.durationMs, 0);
    const runtime = computeRuntime(report);
    const memory = computeMemory(report);
    const size = sizeById.get(report.package.id);
    const bundleBytes = size?.totalBytes ?? 0;
    const depCount = Object.keys(report.package.dependencies).length;

    const sample = sampleById.get(report.package.id);
    const estimatedWeight = Math.round(
      bundleBytes / KB + depCount * 5 + checkMs / 10 + scenarioMs / 10,
    );
    const build: BuildPerformanceMetrics = sample
      ? {
          durationMs: sample.durationMs,
          estimatedWeight,
          contribution: 0,
          cacheHit: sample.cacheHit,
          failed: sample.failed,
          measured: true,
        }
      : { estimatedWeight, contribution: 0, measured: false };

    return {
      weight: sample?.durationMs ?? estimatedWeight,
      report: {
        id: report.package.id,
        name: report.package.name,
        build,
        runtime,
        memory,
        bundleBytes,
        gzipBytes: size?.gzipBytes,
        checkMs,
        scenarioMs,
      },
    };
  });

  const totalWeight = raws.reduce((s, r) => s + r.weight, 0) || 1;
  for (const r of raws)
    r.report.build.contribution =
      Math.round((r.weight / totalWeight) * 1000) / 1000;

  const packages = raws.map((r) => r.report);
  const measuredBuild = opts.buildSamples && opts.buildSamples.length > 0;

  return {
    id: `perf-${at}`,
    timestamp: at,
    workspacePath: opts.workspacePath,
    packages,
    checkCosts: aggregateCheckCosts(opts.run),
    dependencyCosts: analyzeDependencyCosts(opts.intel),
    totals: {
      buildMs: measuredBuild
        ? raws.reduce((s, r) => s + (r.report.build.durationMs ?? 0), 0)
        : undefined,
      estimatedBuildWeight: raws.reduce(
        (s, r) => s + r.report.build.estimatedWeight,
        0,
      ),
      checkMs: packages.reduce((s, p) => s + p.checkMs, 0),
      scenarioMs: packages.reduce((s, p) => s + p.scenarioMs, 0),
      runtimeImportMs: packages.reduce(
        (s, p) => s + p.runtime.importLatencyMs,
        0,
      ),
      peakMemoryBytes: Math.max(0, ...packages.map((p) => p.memory.peakBytes)),
      bundleBytes: packages.reduce((s, p) => s + p.bundleBytes, 0),
    },
  };
}

function aggregateCheckCosts(run: WorkbenchRun): CheckCost[] {
  const byId = new Map<string, { total: number; count: number }>();
  for (const report of run.reports) {
    for (const c of report.checks) {
      if (c.durationMs == null) continue;
      const entry = byId.get(c.checkId) ?? { total: 0, count: 0 };
      entry.total += c.durationMs;
      entry.count += 1;
      byId.set(c.checkId, entry);
    }
  }
  return [...byId.entries()]
    .map(([checkId, { total, count }]) => ({
      checkId,
      totalMs: total,
      count,
      avgMs: Math.round(total / count),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}
