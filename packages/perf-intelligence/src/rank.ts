import type { Bottleneck, PerformanceSnapshot } from "./types";

/**
 * Bottleneck ranking across the five categories (build, runtime, memory,
 * dependency, CI). Picks the single biggest contributor per category — the
 * "where do I look first" list. Pure + deterministic.
 */

const ms = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
const mb = (b: number): string => `${Math.round(b / 1e6)} MB`;

export function rankBottlenecks(snapshot: PerformanceSnapshot): Bottleneck[] {
  const out: Bottleneck[] = [];

  // Build — the package contributing the most build cost.
  const topBuild = [...snapshot.packages].sort(
    (a, b) => b.build.contribution - a.build.contribution,
  )[0];
  if (topBuild && topBuild.build.contribution > 0) {
    const value =
      topBuild.build.measured && topBuild.build.durationMs != null
        ? ms(topBuild.build.durationMs)
        : `${Math.round(topBuild.build.contribution * 100)}% of total`;
    out.push({
      category: "build",
      subject: topBuild.name,
      metric: topBuild.build.measured ? "build time" : "estimated build cost",
      value,
      detail: `${Math.round(topBuild.build.contribution * 100)}% of total build cost`,
    });
  }

  // Runtime — slowest import latency.
  const topRuntime = [...snapshot.packages].sort(
    (a, b) => b.runtime.importLatencyMs - a.runtime.importLatencyMs,
  )[0];
  if (topRuntime && topRuntime.runtime.importLatencyMs > 0) {
    out.push({
      category: "runtime",
      subject: topRuntime.name,
      metric: "import latency",
      value: ms(topRuntime.runtime.importLatencyMs),
      detail: `slowest single import ${ms(topRuntime.runtime.slowestImportMs)}`,
    });
  }

  // Memory — highest peak.
  const topMem = [...snapshot.packages].sort(
    (a, b) => b.memory.peakBytes - a.memory.peakBytes,
  )[0];
  if (topMem && topMem.memory.peakBytes > 0) {
    out.push({
      category: "memory",
      subject: topMem.name,
      metric: "peak memory",
      value: mb(topMem.memory.peakBytes),
      detail: topMem.memory.leakSuspicion
        ? "leak suspected (memory grows across scenarios)"
        : topMem.memory.spike
          ? "memory spike detected"
          : "highest peak heap use",
    });
  }

  // Dependency — the costliest dependency.
  const topDep = snapshot.dependencyCosts[0];
  if (topDep) {
    out.push({
      category: "dependency",
      subject: topDep.dependency,
      metric: topDep.kind,
      value: topDep.versions
        ? `${topDep.versions.length} versions`
        : topDep.kind,
      detail: topDep.detail,
    });
  }

  // CI — the most expensive check overall.
  const topCheck = snapshot.checkCosts[0];
  if (topCheck && topCheck.totalMs > 0) {
    out.push({
      category: "ci",
      subject: topCheck.checkId,
      metric: "total check time",
      value: ms(topCheck.totalMs),
      detail: `${topCheck.count} run(s), avg ${ms(topCheck.avgMs)}`,
    });
  }

  return out;
}
